import * as vscode from 'vscode';
import { ClaudeChatPanel } from './chatPanel';
import { ClaudeApiClient } from './claudeClient';

export function activate(context: vscode.ExtensionContext) {
  console.log('Claude Web Chat extension activated');

  const client = new ClaudeApiClient(context);

  // Open chat panel
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeWebChat.openChat', () => {
      ClaudeChatPanel.createOrShow(context, client);
    })
  );

  // Set cookie command
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeWebChat.setCookie', async () => {
      const instructions = [
        '📋 How to get your Claude session cookie:',
        '',
        '1. Open claude.ai in your browser and log in',
        '2. Open DevTools (F12)',
        '3. Go to Application → Cookies → https://claude.ai',
        '4. Find "sessionKey" cookie and copy its value',
        '',
        'Alternatively, copy the full Cookie header from a Network request to claude.ai/api/*',
      ].join('\n');

      vscode.window.showInformationMessage(instructions, { modal: true }, 'OK');

      const cookie = await vscode.window.showInputBox({
        prompt: 'Paste your Claude session cookie (sessionKey=...) or full Cookie header',
        placeHolder: 'sessionKey=sk-ant-sid01-...',
        password: true,
        ignoreFocusOut: true,
      });

      if (cookie) {
        await client.setCookie(cookie);
        vscode.window.showInformationMessage('✅ Cookie saved! Open the chat panel to start chatting.');
      }
    })
  );

  // Clear cookie
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeWebChat.clearCookie', async () => {
      await client.clearCookie();
      vscode.window.showInformationMessage('🗑️ Cookie cleared.');
    })
  );

  // Ask about selection
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeWebChat.askSelection', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.document.getText(editor.selection);
      if (!selection) {
        vscode.window.showWarningMessage('No text selected.');
        return;
      }

      const lang = editor.document.languageId;
      const initialMessage = `Here's some ${lang} code I'd like help with:\n\`\`\`${lang}\n${selection}\n\`\`\`\n\n`;
      ClaudeChatPanel.createOrShow(context, client, initialMessage);
    })
  );
}

export function deactivate() {}
