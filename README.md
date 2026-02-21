# Claude Web Chat — VS Code Extension

> ⚠️ **Experimental / Personal Use Only**  
> This extension uses your browser session cookie to talk to claude.ai — not the official API. Use at your own risk.

---

## Setup

### 1. Install dependencies & compile

```bash
cd claude-web-chat
npm install
npm run compile
```

### 2. Open in VS Code

```bash
code .
```

Then press **F5** to launch the Extension Development Host.

---

## Getting Your Session Cookie

1. Open **[claude.ai](https://claude.ai)** in your browser and log in
2. Open **DevTools** (`F12`)
3. Go to **Application** → **Cookies** → `https://claude.ai`
4. Find the **`sessionKey`** cookie and copy its value

   OR:

   Go to **Network** tab → click any request to `claude.ai/api/*` → **Headers** tab → copy the full **`Cookie:`** header value

---

## Usage

### Commands

| Command | Shortcut | Description |
|---|---|---|
| `Claude: Open Chat Panel` | `Ctrl+Shift+C` | Open the chat sidebar |
| `Claude: Set Session Cookie` | — | Paste your session cookie (stored securely in VS Code's secret storage) |
| `Claude: Clear Session Cookie` | — | Remove stored cookie |
| `Claude: Ask About Selection` | Right-click menu | Send selected code to Claude |

### Chat Features

- 💬 Multi-turn conversation memory
- 📋 Right-click code selection → "Ask Claude About Selection"
- ✨ Streaming responses
- 🔄 "New Chat" to reset conversation
- 🔒 Cookie stored in VS Code **SecretStorage** (not plaintext)

---

## How It Works

The extension mimics a browser session:

1. Gets your organization ID via `GET /api/organizations`
2. Creates a conversation via `POST /api/organizations/{orgId}/chat_conversations`
3. Sends messages via `POST /api/.../completion` with SSE streaming
4. All requests include your session cookie as the `Cookie` header

---

## Notes

- Your cookie will expire when you log out of claude.ai or after Anthropic's session timeout
- If you get `401`/`403` errors, refresh your cookie
- This is not affiliated with or endorsed by Anthropic
