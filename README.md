# ⚡ MachCode

<p align="center">
  <strong>Multi-Model Parallel Racing AI Coding & Q&A CLI</strong><br />
  <em>Antigravity / Claude Code / OpenCode grade interactive terminal assistant powered by full-pool parallel LLM racing across 57+ NVIDIA NIM models (21+ AI providers), adaptive Q&A + surgical code editing, and a continuous interactive REPL.</em>
</p>

<p align="center">
  <a href="https://github.com/gokaykrbs/MachCode/releases"><img src="https://img.shields.io/badge/version-v0.1.0-blue.svg?style=flat-square" alt="version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="https://github.com/gokaykrbs/MachCode/actions"><img src="https://img.shields.io/badge/tests-38%2F38%20passing-brightgreen.svg?style=flat-square" alt="Tests Passing" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.6-blue.svg?style=flat-square&logo=typescript" alt="TypeScript" /></a>
  <a href="https://build.nvidia.com"><img src="https://img.shields.io/badge/NVIDIA%20NIM-57%2B%20Models%20Racing-76B900.svg?style=flat-square&logo=nvidia" alt="NVIDIA NIM" /></a>
  <a href="#"><img src="https://img.shields.io/badge/REPL-Interactive%20Q%26A%20%2B%20Code-cyan.svg?style=flat-square" alt="REPL Mode" /></a>
</p>

---

> _"Every model in your API key races in parallel. The fastest intelligence wins. Zero hallucinations, zero wait."_

**MachCode** is a terminal-native AI coding and conversational Q&A CLI engineered for high-velocity software development. Built in the spirit of **Antigravity CLI**, **Claude Code**, and **OpenCode**, MachCode eliminates single-model bottlenecks by firing **all usable generative AI models available in your NVIDIA Build (NIM) API key** (57+ models across 21+ providers such as **OpenAI, Google Gemma, DeepSeek, Qwen, MiniMax, Mistral, Meta Llama, Moonshot Kimi, Microsoft Phi, Z-AI GLM, NVIDIA Nemotron**) in parallel, locking onto the first model that emits a real answer token, and immediately aborting the remaining streams.

---

## 💡 The Problem & The Solution

### 🛑 The Problem: Single-Model Latency Spikes & Rigid CLIs

1. **The Single-Provider Bottleneck:** Deep reasoning and high-parameter coding models (70B–550B) deliver great answers, but frequently suffer from queue delays, cold starts, and 5–15 second Time-to-First-Token (TTFT) spikes.
2. **Hidden Reasoning Leaks:** Many modern reasoning models emit internal chain-of-thought (`reasoning_content`) before actual answer tokens, either polluting the terminal or prematurely winning latency races before producing usable output.
3. **Code-Only vs. Chat Friction:** Traditional terminal tools either force every response into file overwrites or lack surgical workspace editing (`read_file` / `write_file`) and undo snapshots.

### ⚡ The Solution: Full-Pool Parallel Model Racing & Adaptive Dual-Mode REPL

MachCode re-engineers the terminal AI loop around three core pillars:

#### 1. Full-Pool Parallel Stream Racing & Tiered Fallback (`streamRacer.ts`)

Whenever you ask a question or issue a coding instruction, MachCode races all usable generative models in your `StrongPool` simultaneously:

```text
                                 User Prompt / Question
                                           │
                                           ▼
                    [Parallel Multi-Model Race: StrongPool (57+ Models)]
          (OpenAI, Google, DeepSeek, Qwen, MiniMax, Mistral, Meta, Kimi, NVIDIA...)
                                           │
             ┌─────────────────────────────┴─────────────────────────────┐
             │ First Model Emits Real Content Token (200 OK)             │ All Fail / 10s Timeout
             ▼                                                           ▼
   [Instant Lock & Live Stream]                                [WeakPool Fallback Race]
   • Buffers reasoning_content into <plan>                     • Fast lightweight pool race
   • Locks onto winning model & streams cleanly                • Guarantees resilient response
   • Aborts all other 56 pending HTTP streams                  • Never leaves user hanging
   • Displays 🏁 Race Winner & latency telemetry
```

- **Full API Key Discovery (No Artificial 6-Model Cap):** Autonomously discovers and filters every usable generative chat/coding model on your NVIDIA NIM API key (excluding non-chat embedding, guard, clip, and parser endpoints) into `strongPool` and `weakPool`.
- **True Content-Token Racing:** Separates internal `delta.reasoning_content` from user-facing `delta.content`. A model only wins the race when it emits its **first actual answer token**, while internal thoughts are tucked inside `<plan>...</plan>` and logged to `~/.machcode/debug.log`.
- **Smart Tier Calibration:** Applies an automatic `1800ms` grace window to ultra-tiny 4B models (`bolt-e4b`) during multi-model races so 20B–550B frontier models compete fairly on first-token speed without being crowded out.
- **Instant Lock & Clean Abort:** The moment a winner locks in, all other in-flight HTTP connections are aborted via `AbortController`—zero mid-sentence model switching.

#### 2. Adaptive Dual-Mode Intelligence (Conversational Q&A + Agentic Coding)

MachCode naturally adapts to your intent in your own language (English, Turkish, etc.):

- **Conversational Q&A Mode:** Ask questions, brainstorm architecture, debug errors, or request explanations directly in the terminal. Illustrative code snippets without `// file: <path>` headers are printed cleanly to the screen without touching disk files.
- **Surgical Coding Mode:** Ask MachCode to create, refactor, or fix files. It inspects your workspace via `read_file`, outputs complete code blocks with `// file: <path>` headers, snapshots originals for `/undo`, and writes changes cleanly.

#### 3. Responsive Antigravity-Style Terminal UI & 17 Slash Commands

MachCode features a compact **13-column geometric block logo** and dynamic viewport truncation that never wraps or distorts when your terminal window is resized or split-screened.

---

## ✨ Key Features

- 🏁 **57+ Model Parallel Racing Engine:** Simultaneously races all usable generative models across 21+ AI providers in your NVIDIA NIM account and locks onto the fastest responder.
- 🛡️ **Antigravity / Claude Code Style Interactive Approval:** Shows a colorized line-diff preview card before creating or modifying any file and prompts `[Y]es / [n]o / [a]ll / [d]iff` (can be toggled anytime with `/approve` or `-y / --auto-approve`).
- 💬 **Antigravity / Claude Code Grade Q&A + Coding:** Seamlessly chat, ask questions in any language, explain codebases, or trigger autonomous multi-file edits in the same session.
- 📊 **Live Race Telemetry & `/race` Benchmark:** Every response displays the winning model, provider count, and exact first-token latency (`🏁 Race Winner`), plus a dedicated `/race` command for live parallel speed tests.
- 🤖 **Zero-Config Autonomous AutoRouter:** Dynamically discovers active NVIDIA NIM models in the background and populates `strongPool` and `weakPool` in `~/.machcode/config.json`.
- 🔄 **Self-Healing Deprecation Recovery:** Automatically catches HTTP 404/410 model deprecations, re-scans active NIM endpoints, updates the pool, and retries transparently.
- 📐 **Responsive Compact Block Logo:** Antigravity CLI-inspired geometric `M` block badge (`13 cols`) that stays crisp even on narrow split-screen terminals.
- 🛑 **"Stop & Ask" Protocol:** If critical specifications are ambiguous during file modifications, MachCode halts and prompts you with `? QUESTION: [details]` instead of guessing.
- 🛡️ **In-Memory Undo & Revert (`/undo`):** Captures pre-modification file snapshots in memory before every write so you can revert AI edits instantly.
- 🧩 **Native NVIDIA Agent Skills:** Automatic integration with official [`NVIDIA/skills`](https://github.com/NVIDIA/skills) definitions and workspace tools (`read_file`, `write_file`).

---

## 📦 Installation

### Prerequisites

- [Node.js](https://nodejs.org/) `>= 18.0.0`
- [pnpm](https://pnpm.io/) `>= 9.0.0` or `npm`
- An [NVIDIA Build (NIM)](https://build.nvidia.com) API key (`nvapi-...`)

### Local Setup (From Source & Global Symlink)

```bash
# 1. Clone the repository
git clone https://github.com/gokaykrbs/MachCode.git
cd MachCode

# 2. Install dependencies
npm install # or pnpm install

# 3. Build TypeScript to dist/
npm run build

# 4. Link globally (enables the `mach` command everywhere)
npm link
```

---

## 🚀 Quick Start & Usage

### 1. Launch the Interactive REPL

Run `mach` (or `node dist/index.js`) inside any project directory:

```bash
mach
```

On first launch, MachCode prompts for your `NVIDIA_API_KEY`, discovers all usable generative models on your key, and saves them to `~/.machcode/config.json`.

### 2. The Interactive Shell

```text
  ╭───────────╮  ⚡ MachCode v0.1.0
  │  ██▄ ▄██  │  Engine:   Multi-Model AI Coding & Q&A CLI
  │  ███████  │  Models:   57 AI models racing (21 providers)
  │  ██ ▀ ██  │  Session:  mc_d9zy7sz2 • FS, Git, NIM
  │  ██   ██  │  Path:     D:\My Projects\MachCode
  ╰───────────╯  Commands: /ask • /race • /plan • /help • /exit

  Ask anything, chat, or give a coding task. Type /help for commands.

[machcode✨] > Bu projedeki streamRacer mimarisini kısaca açıkla
🏁 Race Winner: minimaxai/minimax-m3.1-flash (428ms across 57 models)
...

[machcode✨] > /race
[machcode✨] > Add a rate-limiting helper in src/utils/rateLimit.ts
[machcode✨] > /diff
[machcode✨] > /undo
[machcode✨] > /exit
```

### 3. One-Shot CLI Execution

Pass an initial question or coding instruction directly from the command line:

```bash
mach "Explain how autoRouter categorizes NVIDIA NIM models"
mach "Implement rate-limiting middleware in src/middleware/rateLimit.ts" -f src/middleware/rateLimit.ts
```

---

## 📖 Command Reference (17 Slash Commands)

MachCode routes any input starting with `/` to the **Command Registry**.

### 🧠 Context & Memory

| Command    | Usage          | Aliases                   | Description                                                                     |
| :--------- | :------------- | :------------------------ | :------------------------------------------------------------------------------ |
| `/add`     | `/add <path>`  | —                         | Add a specific file or entire directory to the active session context.          |
| `/drop`    | `/drop <path>` | —                         | Remove a file or directory from the active session context.                     |
| `/reset`   | `/reset`       | `/clear-history`, `/wipe` | Clear conversation history, loaded context files, and token counters.           |
| `/context` | `/context`     | —                         | Display loaded files, session turns, workspace path, and token usage estimates. |

### ⚡ Execution & Modes

| Command   | Usage              | Aliases                     | Description                                                                      |
| :-------- | :----------------- | :-------------------------- | :------------------------------------------------------------------------------- |
| `/ask`    | `/ask <question>`  | `/chat`, `/explain`, `/qna` | Ask a question, explain code, or chat in read-only mode without modifying files. |
| `/plan`   | `/plan <prompt>`   | —                           | Generate an architectural implementation plan without modifying any files.       |
| `/heavy`  | `/heavy <prompt>`  | `/deep`, `/hw`              | Bypass racing and execute using exclusively the Heavyweight model.               |
| `/fast`   | `/fast <prompt>`   | `/light`, `/quick`          | Bypass racing and execute using exclusively the Lightweight model.               |
| `/review` | `/review <file>`   | `/audit`, `/inspect`        | Run an in-depth security, bug, and quality review on a file without editing it.  |

### 🛡️ Safety & Git

| Command    | Usage                   | Aliases                                              | Description                                                                   |
| :--------- | :---------------------- | :--------------------------------------------------- | :---------------------------------------------------------------------------- |
| `/approve` | `/approve [ask\|auto]`  | `/confirm`, `/permissions`, `/auto-approve`, `/yolo` | Toggle interactive diff approval before modifying files (Ask vs Auto-Approve).|
| `/undo`    | `/undo`                 | `/revert`                                            | Revert the last file modification made by the AI using in-memory snapshots.   |
| `/diff`    | `/diff`                 | —                                                    | Inspect colorized terminal diff of uncommitted Git changes in the workspace.  |
| `/commit`  | `/commit`               | `/ci`                                                | Analyze current git diff, generate a conventional commit message, and commit. |

### ⚙️ System & Benchmarking

| Command   | Usage                     | Aliases                                | Description                                                                          |
| :-------- | :------------------------ | :------------------------------------- | :----------------------------------------------------------------------------------- |
| `/race`   | `/race`                   | `/benchmark`, `/ping`                  | Run a live parallel speed benchmark across the AI models in your racing pool.        |
| `/config` | `/config [refresh\|key]`  | `/setup`, `/apikey`, `/models`, `/router` | View active racing pools, run `/config refresh` to rescan NIM models, or update key. |
| `/tokens` | `/tokens`                 | `/stats`, `/usage`                     | View session token consumption statistics.                                           |
| `/run`    | `/run <shell-command>`    | `/sh`, `/exec`                         | Execute a shell command directly in the current workspace (e.g. `/run npm test`).    |
| `/help`   | `/help`                   | `/h`, `/commands`                      | Print a formatted table of all registered slash commands.                            |
| `/clear`  | `/clear`                  | `/cls`                                 | Clear the terminal screen and render the compact MachCode logo banner.               |
| `/exit`   | `/exit`                   | `/quit`, `/q`, `/:q`                   | Gracefully close and exit the MachCode CLI.                                          |

---

## 🏗️ Architecture Map

```text
machcode/
├── bin/
│   └── machcode.ts          # CLI binary & entry point (Commander.js -> startRepl)
├── src/
│   ├── commands/            # Scalable Command Registry & 17 Slash Command handlers
│   │   ├── types.ts         # SlashCommand, CommandContext & FileSnapshot interfaces
│   │   ├── commandHandler.ts# Dynamic CommandRegistry dispatcher
│   │   ├── context.ts       # Context & Memory commands (/add, /drop, /reset, /context)
│   │   ├── execution.ts     # Execution Modes (/ask, /plan, /heavy, /fast, /review)
│   │   ├── git.ts           # Safety & Git commands (/undo, /diff, /commit)
│   │   ├── system.ts        # System commands (/help, /tokens, /run, /config, /race, /clear, /exit)
│   │   └── index.ts         # Registry initializer & command aggregator
│   ├── config/              # Config manager (~/.machcode/config.json) & dynamic NIM discovery
│   ├── engine/
│   │   ├── autoRouter.ts    # Full-key generative model discovery & Multi-Provider Pool builder
│   │   ├── streamRacer.ts   # Parallel Multi-Model Stream Racer & Tiered Fallback Engine
│   │   └── executor.ts      # Safe Q&A code block filter, surgical file writer & undo snapshots
│   ├── prompts/
│   │   └── sniper.ts        # Adaptive Dual-Mode (Conversational Q&A + Agentic Coding) prompt
│   ├── tools/
│   │   ├── index.ts         # OpenAI tool calling schemas (read_file, write_file)
│   │   └── nvidiaSkills.ts  # Automatic NVIDIA/skills catalog loader & timeout guards
│   ├── utils/
│   │   └── streamParser.ts  # Stream state machine (isolates <plan>, handles QUESTION:)
│   └── index.ts             # Compact responsive banner, REPL loop & runMachCode orchestrator
├── package.json
└── tsconfig.json
```

---

## 🧪 Testing

MachCode includes a comprehensive test suite covering autonomous model discovery, parallel pool racing, tiered fallback, 10s timeout boundaries, REPL recovery, Stop & Ask loops, and slash commands (`38/38` passing):

```bash
# Compile TypeScript and run all 38 tests across 10 suites
npm test

# Build production bundle
npm run build
```

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for complete license details.
