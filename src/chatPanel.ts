import * as vscode from 'vscode';
import { ClaudeApiClient, Message } from './claudeClient';

export class ClaudeChatPanel {
  public static currentPanel: ClaudeChatPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _client: ClaudeApiClient;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];
  private _messages: Message[] = [];
  private _orgId: string | undefined;
  private _conversationId: string | undefined;

  public static createOrShow(
    context: vscode.ExtensionContext,
    client: ClaudeApiClient,
    initialMessage?: string
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (ClaudeChatPanel.currentPanel) {
      ClaudeChatPanel.currentPanel._panel.reveal(column);
      if (initialMessage) {
        ClaudeChatPanel.currentPanel._panel.webview.postMessage({
          type: 'setInput',
          text: initialMessage,
        });
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'claudeWebChat',
      'Claude Chat',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    ClaudeChatPanel.currentPanel = new ClaudeChatPanel(panel, context, client);

    if (initialMessage) {
      panel.webview.postMessage({ type: 'setInput', text: initialMessage });
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    client: ClaudeApiClient
  ) {
    this._panel = panel;
    this._context = context;
    this._client = client;

    this._panel.webview.html = this._getHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'sendMessage':
            await this._handleUserMessage(message.text);
            break;
          case 'newConversation':
            this._startNewConversation();
            break;
          case 'setCookie':
            await vscode.commands.executeCommand('claudeWebChat.setCookie');
            this._checkCookieStatus();
            break;
        }
      },
      null,
      this._disposables
    );

    this._checkCookieStatus();
  }

  private async _checkCookieStatus() {
    const has = await this._client.hasCookie();
    this._panel.webview.postMessage({ type: 'cookieStatus', hasCookie: has });
  }

  private _startNewConversation() {
    this._messages = [];
    this._conversationId = undefined;
    this._panel.webview.postMessage({ type: 'clearChat' });
  }

  private async _handleUserMessage(text: string) {
    if (!text.trim()) return;

    const hasCookie = await this._client.hasCookie();
    if (!hasCookie) {
      this._panel.webview.postMessage({
        type: 'error',
        text: 'No session cookie set. Click "Set Cookie" to configure.',
      });
      return;
    }

    this._messages.push({ role: 'user', content: text });
    this._panel.webview.postMessage({ type: 'userMessage', text });
    this._panel.webview.postMessage({ type: 'thinking' });

    try {
      // Get org ID if we don't have it
      if (!this._orgId) {
        this._panel.webview.postMessage({ type: 'status', text: 'Getting organization...' });
        this._orgId = await this._client.getOrganizationId();
      }

      // Create conversation if we don't have one
      if (!this._conversationId) {
        this._panel.webview.postMessage({ type: 'status', text: 'Starting conversation...' });
        this._conversationId = await this._createConversation();
      }

      let fullResponse = '';
      this._panel.webview.postMessage({ type: 'startAssistantMessage' });

      await this._client.sendMessage(
        this._orgId,
        this._conversationId,
        this._messages,
        (chunk) => {
          fullResponse += chunk;
          this._panel.webview.postMessage({ type: 'chunk', text: chunk });
        },
        () => {
          this._messages.push({ role: 'assistant', content: fullResponse });
          this._panel.webview.postMessage({ type: 'done' });
        },
        (err) => {
          this._panel.webview.postMessage({
            type: 'error',
            text: `Error: ${err.message}`,
          });
        }
      );
    } catch (err: any) {
      this._panel.webview.postMessage({
        type: 'error',
        text: `Error: ${err.message}`,
      });
    }
  }

  private async _createConversation(): Promise<string> {
    const cookie = await this._client.getCookie();
    if (!cookie || !this._orgId) throw new Error('Missing cookie or org ID');

    return new Promise((resolve, reject) => {
      const uuid = this._generateUUID();
      const https = require('https');
      const body = JSON.stringify({ uuid, name: '' });
      const cookieHeader = cookie.includes('=') ? cookie : `sessionKey=${cookie}`;

      const req = https.request(
        {
          hostname: 'claude.ai',
          path: `/api/organizations/${this._orgId}/chat_conversations`,
          method: 'POST',
          headers: {
            Cookie: cookieHeader,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body).toString(),
            'User-Agent': 'Mozilla/5.0 (compatible; VSCode Extension)',
            Origin: 'https://claude.ai',
            Referer: 'https://claude.ai/',
          },
        },
        (res: any) => {
          let data = '';
          res.on('data', (c: any) => (data += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.uuid) resolve(parsed.uuid);
              else reject(new Error(`No UUID in response: ${data}`));
            } catch (e) {
              reject(new Error(`Parse error: ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private _generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  public dispose() {
    ClaudeChatPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  private _getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Claude Chat</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }

  header h1 {
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }

  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }

  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }

  #cookie-banner {
    background: var(--vscode-inputValidation-warningBackground);
    border: 1px solid var(--vscode-inputValidation-warningBorder);
    color: var(--vscode-inputValidation-warningForeground);
    padding: 10px 16px;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-shrink: 0;
  }
  #cookie-banner.hidden { display: none; }

  #chat-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    scroll-behavior: smooth;
  }

  .message {
    display: flex;
    gap: 10px;
    max-width: 100%;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .message.user { flex-direction: row-reverse; }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .avatar.user {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .avatar.assistant {
    background: #c084fc;
    color: white;
  }

  .bubble {
    max-width: calc(100% - 44px);
    padding: 10px 14px;
    border-radius: 12px;
    line-height: 1.6;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message.user .bubble {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-top-right-radius: 4px;
  }

  .message.assistant .bubble {
    background: var(--vscode-editor-inactiveSelectionBackground);
    border-top-left-radius: 4px;
  }

  .bubble code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
  }

  .bubble pre {
    background: var(--vscode-textCodeBlock-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 10px 12px;
    overflow-x: auto;
    margin: 8px 0;
  }

  .bubble pre code {
    background: none;
    padding: 0;
    font-size: 12px;
  }

  .thinking {
    display: flex;
    gap: 10px;
    align-items: center;
    opacity: 0.7;
  }

  .thinking-dots {
    display: flex;
    gap: 4px;
    padding: 10px 14px;
    background: var(--vscode-editor-inactiveSelectionBackground);
    border-radius: 12px;
    border-top-left-radius: 4px;
  }

  .dot {
    width: 6px; height: 6px;
    background: var(--vscode-editor-foreground);
    border-radius: 50%;
    animation: bounce 1.2s ease infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
    30% { transform: translateY(-5px); opacity: 1; }
  }

  .status-msg {
    text-align: center;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.7;
  }

  .error-msg {
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    color: var(--vscode-errorForeground);
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  footer {
    border-top: 1px solid var(--vscode-panel-border);
    padding: 12px;
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }

  .input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }

  #message-input {
    flex: 1;
    resize: none;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 8px;
    padding: 8px 12px;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.5;
    outline: none;
    min-height: 40px;
    max-height: 150px;
    overflow-y: auto;
    transition: border-color 0.15s;
  }
  #message-input:focus {
    border-color: var(--vscode-focusBorder);
  }

  #send-btn {
    height: 38px;
    padding: 0 14px;
    font-size: 16px;
    border-radius: 8px;
  }
  #send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .hint {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-top: 6px;
    text-align: right;
  }

  .disclaimer {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    text-align: center;
    padding: 4px 0;
    opacity: 0.6;
  }
</style>
</head>
<body>
<header>
  <h1>
    <span>🤖</span> Claude Chat
  </h1>
  <div class="header-actions">
    <button class="btn-secondary" onclick="newConversation()">New Chat</button>
    <button class="btn-secondary" onclick="openCookieSetup()">Set Cookie</button>
  </div>
</header>

<div id="cookie-banner" class="hidden">
  ⚠️ No session cookie configured.
  <button onclick="openCookieSetup()">Set Cookie</button>
</div>

<div id="chat-container">
  <div class="status-msg">Start a conversation with Claude</div>
</div>

<footer>
  <div class="input-row">
    <textarea
      id="message-input"
      rows="1"
      placeholder="Ask Claude anything… (Shift+Enter for newline)"
      onkeydown="handleKey(event)"
      oninput="autoResize(this)"
    ></textarea>
    <button id="send-btn" onclick="sendMessage()">➤</button>
  </div>
  <div class="hint">Enter to send · Shift+Enter for newline</div>
  <div class="disclaimer">⚠️ Experimental: uses web session cookie, not official API</div>
</footer>

<script>
const vscode = acquireVsCodeApi();
let isWaiting = false;
let currentAssistantBubble = null;
let currentAssistantText = '';

window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'cookieStatus':
      document.getElementById('cookie-banner').classList.toggle('hidden', msg.hasCookie);
      break;
    case 'userMessage':
      removeThinking();
      appendMessage('user', msg.text);
      break;
    case 'thinking':
      appendThinking();
      break;
    case 'status':
      updateThinkingText(msg.text);
      break;
    case 'startAssistantMessage':
      removeThinking();
      currentAssistantText = '';
      currentAssistantBubble = createAssistantBubble();
      break;
    case 'chunk':
      currentAssistantText += msg.text;
      if (currentAssistantBubble) {
        currentAssistantBubble.textContent = currentAssistantText;
        scrollToBottom();
      }
      break;
    case 'done':
      isWaiting = false;
      document.getElementById('send-btn').disabled = false;
      if (currentAssistantBubble) {
        // Render basic markdown
        currentAssistantBubble.innerHTML = renderMarkdown(currentAssistantText);
        currentAssistantBubble = null;
        currentAssistantText = '';
      }
      scrollToBottom();
      break;
    case 'error':
      removeThinking();
      isWaiting = false;
      document.getElementById('send-btn').disabled = false;
      appendError(msg.text);
      break;
    case 'clearChat':
      document.getElementById('chat-container').innerHTML =
        '<div class="status-msg">New conversation started</div>';
      break;
    case 'setInput':
      const inp = document.getElementById('message-input');
      inp.value = msg.text;
      autoResize(inp);
      break;
  }
});

function sendMessage() {
  if (isWaiting) return;
  const inp = document.getElementById('message-input');
  const text = inp.value.trim();
  if (!text) return;

  inp.value = '';
  autoResize(inp);
  isWaiting = true;
  document.getElementById('send-btn').disabled = true;

  vscode.postMessage({ type: 'sendMessage', text });
}

function newConversation() {
  isWaiting = false;
  currentAssistantBubble = null;
  document.getElementById('send-btn').disabled = false;
  vscode.postMessage({ type: 'newConversation' });
}

function openCookieSetup() {
  vscode.postMessage({ type: 'setCookie' });
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

function appendMessage(role, text) {
  const chat = document.getElementById('chat-container');
  const div = document.createElement('div');
  div.className = 'message ' + role;
  const avatarText = role === 'user' ? 'U' : 'AI';
  div.innerHTML = \`
    <div class="avatar \${role}">\${avatarText}</div>
    <div class="bubble">\${role === 'user' ? escapeHtml(text) : renderMarkdown(text)}</div>
  \`;
  chat.appendChild(div);
  scrollToBottom();
}

function createAssistantBubble() {
  const chat = document.getElementById('chat-container');
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = '<div class="avatar assistant">AI</div><div class="bubble"></div>';
  chat.appendChild(div);
  scrollToBottom();
  return div.querySelector('.bubble');
}

let thinkingEl = null;
function appendThinking() {
  removeThinking();
  const chat = document.getElementById('chat-container');
  thinkingEl = document.createElement('div');
  thinkingEl.className = 'thinking';
  thinkingEl.innerHTML = \`
    <div class="avatar assistant">AI</div>
    <div class="thinking-dots" id="thinking-label">
      <div class="dot"></div><div class="dot"></div><div class="dot"></div>
    </div>
  \`;
  chat.appendChild(thinkingEl);
  scrollToBottom();
}

function updateThinkingText(text) {
  const lbl = document.getElementById('thinking-label');
  if (lbl) lbl.textContent = text;
}

function removeThinking() {
  if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
}

function appendError(text) {
  const chat = document.getElementById('chat-container');
  const div = document.createElement('div');
  div.className = 'error-msg';
  div.textContent = text;
  chat.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  const chat = document.getElementById('chat-container');
  chat.scrollTop = chat.scrollHeight;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  // Basic markdown rendering
  let html = escapeHtml(text);
  
  // Code blocks
  html = html.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
    return \`<pre><code class="lang-\${lang}">\${code.trim()}</code></pre>\`;
  });
  
  // Inline code
  html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  
  // Bold
  html = html.replace(/\\*\\*([^\\*]+)\\*\\*/g, '<strong>$1</strong>');
  
  // Italic
  html = html.replace(/\\*([^\\*]+)\\*/g, '<em>$1</em>');
  
  // Line breaks
  html = html.replace(/\\n/g, '<br>');
  
  return html;
}
</script>
</body>
</html>`;
  }
}
