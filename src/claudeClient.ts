import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';

const COOKIE_KEY = 'claudeWebChat.sessionCookie';
const BASE_URL = 'claude.ai';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export class ClaudeApiClient {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async setCookie(cookie: string) {
    await this.context.secrets.store(COOKIE_KEY, cookie.trim());
  }

  async clearCookie() {
    await this.context.secrets.delete(COOKIE_KEY);
  }

  async getCookie(): Promise<string | undefined> {
    return this.context.secrets.get(COOKIE_KEY);
  }

  async hasCookie(): Promise<boolean> {
    const c = await this.getCookie();
    return !!c;
  }

  /**
   * Creates a new conversation on claude.ai and returns the conversation UUID.
   */
  async createConversation(): Promise<string> {
    const cookie = await this.getCookie();
    if (!cookie) throw new Error('No session cookie set. Use "Claude: Set Session Cookie" command.');

    const body = JSON.stringify({ uuid: this.generateUUID(), name: '' });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: BASE_URL,
          path: '/api/organizations/' + 'unknown' + '/chat_conversations',
          method: 'POST',
          headers: this.buildHeaders(cookie, body),
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              // First, try to get org ID if we don't have it
              if (res.statusCode === 404 || res.statusCode === 403) {
                reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                return;
              }
              const parsed = JSON.parse(data);
              resolve(parsed.uuid);
            } catch (e) {
              reject(new Error(`Failed to parse response: ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Gets the organization ID for the current user.
   */
  async getOrganizationId(): Promise<string> {
    const cookie = await this.getCookie();
    if (!cookie) throw new Error('No session cookie set.');

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: BASE_URL,
          path: '/api/organizations',
          method: 'GET',
          headers: this.buildHeaders(cookie),
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const orgs = JSON.parse(data);
              if (!Array.isArray(orgs) || orgs.length === 0) {
                reject(new Error(`Could not get organization. Response: ${data}`));
                return;
              }
              resolve(orgs[0].uuid);
            } catch (e) {
              reject(new Error(`Failed to parse org response: ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Sends a message and streams back the response.
   * Calls onChunk for each streamed text chunk, onDone when finished.
   */
  async sendMessage(
    orgId: string,
    conversationId: string,
    messages: Message[],
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: Error) => void
  ) {
    const cookie = await this.getCookie();
    if (!cookie) throw new Error('No session cookie set.');

    const lastMessage = messages[messages.length - 1];
    
    const body = JSON.stringify({
      prompt: lastMessage.content,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      attachments: [],
      files: [],
    });

    const req = https.request(
      {
        hostname: BASE_URL,
        path: `/api/organizations/${orgId}/chat_conversations/${conversationId}/completion`,
        method: 'POST',
        headers: {
          ...this.buildHeaders(cookie, body),
          Accept: 'text/event-stream',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errData = '';
          res.on('data', (c) => (errData += c));
          res.on('end', () => onError(new Error(`HTTP ${res.statusCode}: ${errData}`)));
          return;
        }

        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                onDone();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                // Claude.ai SSE format
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                  onChunk(parsed.delta.text);
                } else if (parsed.completion) {
                  // Older format
                  onChunk(parsed.completion);
                }
              } catch {
                // ignore parse errors for non-JSON lines
              }
            }
          }
        });

        res.on('end', () => onDone());
        res.on('error', onError);
      }
    );

    req.on('error', onError);
    req.write(body);
    req.end();
  }

  private buildHeaders(cookie: string, body?: string): Record<string, string> {
    // Normalize cookie - if it's just the value, wrap it
    const cookieHeader = cookie.includes('=') ? cookie : `sessionKey=${cookie}`;
    
    const headers: Record<string, string> = {
      Cookie: cookieHeader,
      'User-Agent': 'Mozilla/5.0 (compatible; VSCode Extension)',
      Origin: 'https://claude.ai',
      Referer: 'https://claude.ai/',
      'Accept-Language': 'en-US,en;q=0.9',
      'anthropic-client-sha': '1',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body).toString();
    }

    return headers;
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
