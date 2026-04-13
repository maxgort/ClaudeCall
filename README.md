<div align="center">

# ClaudeCall

**Your personal communication agent, powered by Claude.**

Send emails, place phone calls, and message people on Telegram — by asking Claude.
Nothing ever sends without your explicit approval. Your keys, your history, your machine.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-100%20passing-brightgreen.svg)](#testing)
[![MCPB](https://img.shields.io/badge/MCPB-0.1.0-purple.svg)](manifest.json)

</div>

---

## What is this

ClaudeCall is a **Claude Desktop extension** that turns Claude into an agent that can actually *do* things on your behalf:

- 📧 Draft and send emails from your own inbox
- 📞 Place outbound phone calls with pre-scripted scenarios
- 💬 Send messages through your own Telegram account (not a bot — your real account, with access to all your contacts)
- 🧠 Remember every interaction across every channel, so context carries across threads and channels

Think of it as the difference between asking Claude "what should I write to Alex?" and saying "**ping Alex about Friday, you've got context from the last thread**" — and Claude actually doing it, showing you the draft, and sending only after you say "ok".

## Why this exists

Most AI assistants stop at generating text. You still have to copy it, open the right app, paste it, press send. ClaudeCall closes that last inch — it's the thing between "Claude writes the message" and "the message is delivered", with a hard human-approval gate so you stay in control.

There are lots of email-automation SaaS products on the market. ClaudeCall is different in three ways:

1. **Self-hosted.** Your credentials never leave your machine. No proxy. No backend you have to trust.
2. **Multi-channel from day one.** Email + voice + Telegram in one extension, not three separate tools glued together.
3. **Approval-first.** Every outbound action is previewed and explicitly approved. Silent auto-sends are impossible by design — the MCP protocol itself enforces a two-step `preview → send` flow.

## Features

### Email (SMTP)
- Drafts follow your style profile (tone, signature, banned phrases)
- Proper `Reply-To` threading — Claude picks up `Message-ID` from inbound context
- Works with any SMTP provider (Gmail, Outlook, Fastmail, custom)
- Real delivery through nodemailer — no web-based tricks

### Voice calls (Vapi)
- Pre-baked scenario templates (restaurant booking, meeting reschedule, appointment confirmation, stale-thread follow-up)
- Variables substituted before the call (`{{restaurant_name}}`, `{{party_size}}`, `{{date}}`…)
- Scenarios live in [skill/scenarios/](skill/scenarios/) as plain markdown — edit them or add your own
- Every call is previewed **including the exact script** the agent will read, before you approve

### Telegram (user account, MTProto)
- Sends through **your own Telegram account** via GramJS / MTProto — not a bot
- Can message any contact you already have, not just people who started a chat with a bot
- Reads dialog history for context before drafting replies
- Fuzzy contact search: ask "message Alex about Friday" and Claude finds which Alex
- One-time SMS login, session stored encrypted

### Cross-channel memory
- Every sent message is logged to a local JSON store, keyed by contact
- Before drafting anything to a known contact, Claude calls `query_history(contact)` and pulls the last N interactions from **all channels**
- Say "follow up with Alex" and Claude knows the last email *and* the last Telegram thread

### Approval gate (the core differentiator)
Every outbound tool is split into `preview → send`:

1. Claude drafts a message and calls `*_preview` → writes a pending row, returns the exact payload that would be sent
2. You see the preview in chat as a code block
3. You reply "send", "ok", "approve" — or "cancel", "nevermind", "stop"
4. Only on affirmative does Claude call `*_send` with the pending ID
5. The pending row is resolved and logged to history

It is structurally impossible for Claude to bypass the preview step — the send tool only accepts a `pending_id`, and the only way to get one is to call `preview` first.

## Quick start

### Option A — One-click install (recommended for most users)

1. Download [`claudecall.mcpb`](https://github.com/maljorka/ClaudeCall/releases/latest) from the latest release
2. Double-click the file on your machine
3. Claude Desktop opens an install dialog with a configuration form
4. Fill in your credentials for the channels you want to use (all channels are optional — enable only what you need)
5. Click **Install**
6. In a new Claude chat, type something like:
   > *Send an email to alice@example.com saying I'll be 15 minutes late for our 3pm.*

That's it. Claude will draft, preview, and wait for your approval.

### Option B — From source (three commands)

```bash
git clone https://github.com/maxgort/ClaudeCall.git
cd ClaudeCall
npm install
npm run setup
```

`npm run setup` launches an **interactive wizard** that walks you through
every channel you want, one at a time. For each channel it:

- Opens the right signup/config page in your browser
- Waits for you to copy the credentials
- Runs any required OAuth login flows (Telegram SMS code, Google consent)
- Saves everything to `~/.claudecall/config.env`
- Patches your Claude Desktop config to register the MCP servers

Typical setup time is 5-15 minutes depending on how many channels you enable.
You can skip any channel by answering `n` and come back to it later by re-running
`npm run setup`.

After it finishes, quit Claude Desktop from the tray and reopen it — your new
tools will appear automatically.

### Getting credentials

`npm run setup` opens each of these in your browser automatically and prompts
you to paste the result. If you'd rather configure manually, here's where
everything lives:

| Service | Where to get it | Cost |
|---|---|---|
| **Gmail SMTP + IMAP** | [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (requires 2FA) | Free |
| **Telegram API** | [my.telegram.org](https://my.telegram.org) → API development tools | Free |
| **Telegram session** | `node scripts/telegram_login.mjs` (interactive, saves session) | Free |
| **Slack bot token** | [api.slack.com/apps](https://api.slack.com/apps) → Create app → OAuth scopes → Install to workspace | Free |
| **Google Calendar OAuth** | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) → Desktop app client | Free |
| **Google Calendar refresh token** | `node scripts/calendar_login.mjs` (browser consent) | Free |
| **Vapi API key + phone + assistant** | [dashboard.vapi.ai](https://dashboard.vapi.ai) | ~$0.10-0.30/min per call |

## Architecture

```
claudecall/
├── bundle/
│   └── index.mjs              Unified MCPB entry point (all 17 tools)
├── manifest.json              MCPB manifest with user_config form
├── mcps/
│   ├── core/                  Profile, history, pending list
│   ├── email/                 SMTP send, preview, cancel
│   ├── voice/                 Vapi call, preview, cancel, scenarios
│   ├── telegram/              User-account MTProto via GramJS
│   └── shared/                Config parser, reply helpers
├── skill/
│   ├── SKILL.md               Main skill prompt — routing, tone, approval rules
│   ├── profile.example.json   Template for your personal style profile
│   ├── scenarios/             Pre-baked voice call scripts
│   └── scripts/               Store, init_db, install_config, paths
├── scripts/
│   ├── e2e_email.mjs          Real SMTP end-to-end test
│   ├── e2e_telegram_user.mjs  Real MTProto end-to-end test
│   └── telegram_login.mjs     Interactive one-time login
├── test/
│   ├── unit/                  Fast unit tests (store, config, helpers, mocks)
│   ├── integration/           Stdio MCP flow tests (no network)
│   └── helpers/               Test harness (spawnMcp, makeTmpRoot)
├── install.sh / install.ps1   One-command setup for git-checkout mode
└── package.json
```

### Runtime flow

```
1. You: "Reschedule the meeting with Ivan to Friday 3pm."
        │
        ▼
2. Claude loads SKILL.md → reads profile.json → queries history for "Ivan"
        │
        ▼
3. Claude picks a channel (email thread exists → email; no email but TG chat → telegram)
        │
        ▼
4. Claude drafts the message and calls <channel>_preview
        │
        ▼
5. MCP server writes pending_id to ~/.claudecall/pending.json
   Returns a human-readable preview
        │
        ▼
6. Claude shows you the preview in chat as a code block
        │
        ▼
7. You: "ok"  →  Claude calls <channel>_send(pending_id)  →  message delivered
   You: "cancel"  →  Claude calls <channel>_cancel(pending_id)  →  nothing sent
        │
        ▼
8. Logger writes an entry to ~/.claudecall/history.json
   Next time you say "follow up with Ivan", the thread is there
```

## The 17 tools

| Tool | What it does |
|---|---|
| `load_profile` | Load your style profile (tone, signature, banned phrases) |
| `query_history` | Recent interactions with a contact across **all** channels |
| `log_sent` | Append a sent or failed action to history |
| `list_pending` | Show orphaned pending drafts |
| `email_preview` | Draft an email, show the exact payload, wait for approval |
| `email_send` | Send a previously-previewed email via SMTP |
| `email_cancel` | Cancel a pending email draft |
| `voice_list_scenarios` | List pre-baked call scripts |
| `voice_preview` | Draft a call with variables substituted, wait for approval |
| `voice_create_call` | Place the approved call through Vapi |
| `voice_cancel` | Cancel a pending call |
| `telegram_preview` | Resolve the chat, show the exact message, wait for approval |
| `telegram_send` | Send through your own Telegram account |
| `telegram_cancel` | Cancel a pending Telegram draft |
| `telegram_list_dialogs` | Your most recent Telegram chats with labels and unread counts |
| `telegram_read_history` | Last N messages in a specific chat — use before drafting replies |
| `telegram_find_contact` | Fuzzy-search your dialogs by name or username |

## Your style profile

ClaudeCall reads `~/.claudecall/profile.json` before every draft. Example:

```json
{
  "user_name": "Alex Rivers",
  "signature": "— Alex",
  "email_signature": "— Alex Rivers\nFounder, Example Co.\nalex@example.com",
  "tone": "warm but brief; direct without being blunt; occasional dry humor",
  "greeting_style": "first-name only, no 'Dear'",
  "max_length_words": 120,
  "avoid_phrases": [
    "I hope this email finds you well",
    "circling back",
    "per my last email",
    "kindly"
  ],
  "timezone": "America/New_York"
}
```

Claude uses this to stay in voice. Edit it whenever you want the agent to sound different.

## Voice call scenarios

Pre-baked scripts live in [skill/scenarios/](skill/scenarios/) as plain markdown. Four ship by default:

- **[restaurant_booking.md](skill/scenarios/restaurant_booking.md)** — reserve a table with party size, date, time, name
- **[reschedule_meeting.md](skill/scenarios/reschedule_meeting.md)** — apologize, propose two alternates, capture the answer
- **[followup_noreply.md](skill/scenarios/followup_noreply.md)** — polite low-pressure ping on a stale thread
- **[confirm_appointment.md](skill/scenarios/confirm_appointment.md)** — reminder + yes/no confirmation

Each is a markdown file with `{{variable}}` placeholders. Add your own by dropping a new `.md` in the folder — the skill picks it up automatically. Scenario names are restricted to `[a-z0-9_]+` (prevents path traversal via prompt injection).

## Safety and privacy

- **Nothing sends without approval.** Every outbound tool is `preview → send`. You physically cannot skip the preview step.
- **Credentials live on your machine only.** In MCPB mode, the OS keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service) stores them. In git-checkout mode, they live in `~/.claudecall/config.env` with filesystem-level permissions.
- **History is local.** `~/.claudecall/history.json` is a plain JSON file on your disk. No cloud sync, no analytics, no telemetry.
- **Credentials are never passed as command-line arguments.** They're read from env vars or a file — never visible in process listings.
- **Input is validated at the schema layer.** Email addresses go through a proper regex, phone numbers are required to be E.164, scenario names are whitelisted, Telegram chat IDs are resolved through the MTProto layer before any send.
- **Failures are loud.** A failed send writes a row to history with the error, surfaces the raw provider error to you, and does not silently retry.

## Testing

100 automated tests, zero network calls in CI, runs in under 10 seconds:

```bash
npm test
```

The test pyramid:

| Layer | What it covers | Framework |
|---|---|---|
| **Unit** | Store, config parser, reply helpers, voice helpers, preview formatters, send functions (with mocked transports) | `node --test` |
| **Integration** | Full stdio MCP handshake, `preview → cancel → send-rejects-cancelled` round trip, cross-channel rejection, unknown scenario rejection, path traversal rejection | `node --test` with child process |
| **Manual E2E** | Real Gmail SMTP send, real MTProto send to real contact | Scripts in `scripts/` |

The integration tests spawn the MCP servers over stdio, send JSON-RPC handshakes and tool calls, and assert on the replies. Everything runs in isolated temp directories — tests never touch `~/.claudecall`.

Send-path tests use **injectable transports** (nodemailer's `jsonTransport`, mock `fetch` for REST APIs, mock GramJS client) so no real credentials are ever needed for CI. Real end-to-end verification is a separate manual step before a release.

## Development

### Requirements
- Node.js 20+
- npm 10+
- (optional, for Telegram) a Telegram account you can log in to

### Setup

```bash
git clone https://github.com/maljorka/ClaudeCall.git
cd ClaudeCall
npm install
npm run init
```

### Running a single MCP server standalone

Each MCP has its own entry point — useful for debugging:

```bash
npm run mcp:email     # just the email server
npm run mcp:voice     # just the voice server
npm run mcp:telegram  # just the telegram server
```

Or all four at once through the bundle entry:

```bash
node bundle/index.mjs
```

### Running tests

```bash
npm test              # everything
npm run test:unit     # just unit tests
npm run test:integration  # just stdio integration tests
```

### Building the MCPB bundle

```bash
npx mcpb pack . claudecall.mcpb
```

### Real end-to-end tests (require credentials)

```bash
# Email — sends a real message through your SMTP
node scripts/e2e_email.mjs you@example.com

# Telegram — one-time login, then send to a real contact
node scripts/telegram_login.mjs
node scripts/e2e_telegram_user.mjs @friend_username
```

## FAQ

**Q: Do I need all three channels?**
No. Every channel is optional. Fill in only the credentials for channels you want. The tools for unconfigured channels will return a helpful error if Claude tries to use them.

**Q: Will Claude try to send something without showing me?**
It can't. The only way to send is to call `email_send(pending_id)` / `voice_create_call(pending_id)` / `telegram_send(pending_id)`. The only way to get a `pending_id` is to call `*_preview` first, which writes a row to disk and returns the preview. Structurally, a send without a preview is impossible.

**Q: Is automating my personal Telegram account against Telegram ToS?**
Automation of user accounts lives in a grey area in Telegram's terms of service. In practice, enforcement targets spammers — personal agent use (drafting replies to friends, finding the right contact, reading your own history) is almost never enforced. If you send hundreds of messages to strangers you will get banned. This project is designed for personal, authenticated, explicitly-approved use only.

**Q: Why not use the Telegram Bot API instead?**
Bots can only message users who started a chat with them first. That's useless for a personal communication agent — your friends, coworkers, and contacts have never /start'd a bot. User-account MTProto is the only way to reach your actual network.

**Q: Can I use this with Outlook / Fastmail / Proton Mail / custom SMTP?**
Yes. Fill in the `SMTP_*` fields with your provider's hostname, port, username, and password. The implementation is plain nodemailer — anything that speaks SMTP works.

**Q: Does it work on macOS / Linux / Windows?**
Yes. The codebase is cross-platform. The installer (`install.sh` / `install.ps1`) handles path differences. MCPB installs work natively on all three.

**Q: What does it cost to run?**
- Email: free (your SMTP provider's normal cost, usually zero)
- Telegram: free
- Voice: Vapi charges ~$0.10-0.30 per minute of call time. A typical restaurant booking costs a few cents.

**Q: How do I add a new voice scenario?**
Drop a markdown file in `skill/scenarios/`. Use `{{variable}}` syntax for placeholders. File name must be lowercase letters, digits, underscores. Restart the MCP (or Claude Desktop) and the scenario will be listed by `voice_list_scenarios`.

**Q: Where is my history stored?**
`~/.claudecall/history.json` on your machine. Plain JSON. You can grep it, back it up, or delete it whenever you want.

**Q: How do I rotate credentials?**
In MCPB mode: reopen the extension's settings in Claude Desktop and update the relevant field. The value in the OS keychain is replaced.
In git-checkout mode: edit `~/.claudecall/config.env` and restart Claude Desktop.

## Roadmap

- [ ] Inbound monitoring — react to new messages on a watched thread
- [ ] WhatsApp via `whatsapp-web.js` (marked experimental — ToS concerns)
- [ ] iMessage on macOS via AppleScript / message DB
- [ ] Slack connector for team comms
- [ ] Calendar integration — propose meeting times from real availability
- [ ] Browser extension for drafting directly from Gmail / Outlook web
- [ ] Multi-profile support (separate "work me" vs "personal me" style profiles)

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

Built for humans who are tired of copy-pasting drafts from AI chat windows into email clients.

</div>
