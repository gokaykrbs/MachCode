# ⚡ MachCode

<p align="center">
  <strong>The Sniper AI Code Editor CLI</strong><br />
  <em>Zero-hallucination, blazing-fast AI code editor CLI powered by Streaming Handoff Racing, continuous interactive REPL, and NVIDIA NIM endpoints.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/machcode"><img src="https://img.shields.io/badge/npm-v0.1.0-blue.svg?style=flat-square" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="#"><img src="https://img.shields.io/badge/build-passing-brightgreen.svg?style=flat-square" alt="Build Status" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.6-blue.svg?style=flat-square&logo=typescript" alt="TypeScript" /></a>
  <a href="https://build.nvidia.com"><img src="https://img.shields.io/badge/NVIDIA%20NIM-Integrated-76B900.svg?style=flat-square&logo=nvidia" alt="NVIDIA NIM" /></a>
  <a href="#"><img src="https://img.shields.io/badge/REPL-Interactive-cyan.svg?style=flat-square" alt="REPL Mode" /></a>
</p>

---

> _"Speed without hallucinations. Intelligence without the wait."_

**MachCode** is a terminal-native, hyper-disciplined AI code editor CLI built for high-velocity software engineering. Inspired by the speed of modern developer workflows and the precision of agentic systems like Claude Code and Aider, MachCode solves the latency versus quality dilemma by concurrently racing multiple **NVIDIA Build (NIM)** LLM endpoints, keeping conversation context in a continuous **interactive REPL session**, and orchestrating workflows through an extensible **Command Registry**.

---

## 💡 The Problem & The Solution

### 🛑 The Problem: Latency Spikes, Hallucinations & Workflow Friction

1. **The Heavyweight Bottleneck:** Deep reasoning and high-parameter coding models (70B+ / reasoning models) deliver great code, but frequently suffer from queue delays, cold starts, and 5-15 second Time-to-First-Token (TTFT) latency spikes.
2. **The Lightweight Dilemma:** Small models (8B - 14B) respond instantly, but frequently hallucinate APIs, omit strict types, or introduce conversational filler and broken syntax.
3. **The One-Shot CLI Fatigue:** Traditional AI CLIs force developers to type `cli "prompt"` over and over for every single revision, discarding conversational memory, re-reading entire project trees from scratch, and breaking developer focus.

### ⚡ The Solution: Streaming Handoff Racing & Continuous REPL

MachCode re-engineers the terminal coding loop with three core pillars:

#### 1. Streaming Handoff Racing Engine

Whenever an instruction is submitted, MachCode fires concurrent streaming requests to both a **Lightweight (Fast)** model and a **Heavyweight (Deep)** model on NVIDIA NIM:

```
                          User Request
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
 [Lightweight Fast Model]               [Heavyweight Deep Model]
 (e.g. Llama-3.3-70B-Instruct)          (e.g. Qwen-2.5-Coder-32B)
            │                                     │
    Emits 1st Token (~200ms)                      │
            │                                     │
    Streams to Terminal                           │
            │                                     │
            ├───► Heavyweight starts within 3s? ──┼──► YES:
            │                                     │    • Abort Lightweight stream instantly
            │                                     │    • Clear terminal via ANSI escape sequences
            │                                     │    • Stream Heavyweight from Token 0!
            │                                     │
            └───► Timeout after 3 seconds ────────┴──► NO:
                                                       • Abort Heavyweight request
                                                       • Keep Lightweight stream to completion
```

- **Instant Visual Feedback:** The Lightweight model starts typing almost immediately (~200ms).
- **The 3-Second Grace Window:** If the Heavyweight model awakens within 3 seconds, MachCode aborts the lightweight stream, wipes previously rendered output, and streams the deep model's solution with zero quality loss.
- **Resilient Fallback:** If the Heavyweight model stalls or queues, MachCode seamlessly retains the fast model without hanging your shell.

#### 2. Continuous Interactive REPL Session

Type `mach` once to enter an uninterrupted Read-Eval-Print Loop:

```
[machcode✨] > Make the login button blue in components/Login.tsx
[machcode✨] > Now make it dark blue with hover states
```

No repetitive CLI commands. The active session retains multi-turn context across consecutive prompts, tracks modified files, and preserves session history in memory.

#### 3. Extensible Command Registry (17+ Slash Commands)

Rather than a fragile switch statement, MachCode implements an open **Command Pattern Registry**. Slash commands (`/add`, `/undo`, `/heavy`, `/plan`, `/diff`) allow seamless memory management, mode toggling, and Git operations without exiting the session.

---

## ✨ Key Features

- 🏎️ **Streaming Handoff Architecture:** Multi-endpoint concurrent streaming with deterministic `AbortController` handoffs and zero-flicker ANSI cursor rewrites.
- 🔁 **Continuous Interactive REPL:** Dedicated `[machcode✨] > ` developer shell with live context retention across multi-step edits.
- ⚡ **Scalable Slash Command System:** 17+ built-in slash commands organized by Category: _Context & Memory_, _Execution Modes_, _Safety & Git_, and _System_.
- 🎯 **The "Sniper" System Prompt:** Synthesized from top-tier coding agent rules: zero conversational filler, zero greetings, strict DRY code fences, and exact file path header annotations.
- 🛑 **"Stop & Ask" Protocol:** If critical types, parameters, or specifications are missing, MachCode halts execution and prompts you with `? QUESTION: [details]` instead of guessing or hallucinating.
- 🛡️ **In-Memory Undo & Revert (`/undo`):** Captures pre-modification file snapshots in a memory stack immediately before overwriting, allowing instant restoration of files modified by the AI.
- 🧠 **Hidden Chain-of-Thought (`<plan>`):** Models reason inside `<plan>...</plan>` XML tags before producing code. MachCode keeps your terminal pristine by streaming only user-facing code and saving plans to `~/.machcode/debug.log`.
- 🧩 **Native NVIDIA Agent Skills:** Automatic integration with official [`NVIDIA/skills`](https://github.com/NVIDIA/skills) definitions (cuDF, cuOpt, CUDA-Q, DOCA, DeepStream, Dynamo) and workspace tools (`read_file`, `write_file`).
- 🌿 **Git-Native Intelligence (`/diff`, `/commit`):** Review uncommitted terminal diffs and generate conventional git commit messages directly from current changes.

---

## 📦 Installation

### Prerequisites

- [Node.js](https://nodejs.org/) `>= 18.0.0`
- [pnpm](https://pnpm.io/) `>= 9.0.0` (recommended) or `npm`
- An [NVIDIA Build (NIM)](https://build.nvidia.com) API key (`nvapi-...`)

### Global Installation

```bash
# Using pnpm (recommended)
pnpm add -g machcode

# Using npm
npm install -g machcode
```

### Local Setup (From Source)

```bash
# 1. Clone the repository
git clone https://github.com/your-username/machcode.git
cd machcode

# 2. Install dependencies
pnpm install

# 3. Build TypeScript to dist/
pnpm build

# 4. Link globally for development
pnpm link --global
```

---

## 🚀 Quick Start & Usage

### 1. Launch the Interactive REPL

Simply type `mach` in your terminal inside any project directory:

```bash
mach
```

On your first run, MachCode will prompt for your `NVIDIA_API_KEY` once and save it securely to `~/.machcode/config.json` (`0o600` permissions). You can also set it via environment variable:

```bash
export NVIDIA_API_KEY="nvapi-your-api-key"
```

### 2. The Interactive Shell

Once launched, you will be greeted by the MachCode terminal banner and dropped into the interactive loop:

```text
⚡ MACHCODE CLI v1.0.0 — Speed-driven autonomous code editor (NVIDIA NIM)
Type your instruction, or /clear to clear screen, /exit to quit.

[machcode✨] > Add a responsive navbar with dark mode toggle in components/Navbar.tsx
[machcode✨] > /diff
[machcode✨] > Now add a search bar to that navbar
[machcode✨] > /commit
[machcode✨] > /exit
```

### 3. One-Shot or Seeding from Command Line

You can also launch MachCode with an initial instruction. MachCode executes the prompt, modifies the files, and remains in the interactive REPL session:

```bash
mach "Implement rate-limiting middleware in src/middleware/rateLimit.ts"
```

### 4. Custom Model Pairing & Handoff Window

Override default model endpoints or tune the handoff grace period:

```bash
mach --light-model meta/llama-3.3-70b-instruct \
     --heavy-model qwen/qwen2.5-coder-32b-instruct \
     --window 2500
```

---

## 📖 Command Reference (Slash Commands)

MachCode routes any input starting with `/` to the **Command Registry**.

### 🧠 Context & Memory

| Command    | Usage          | Aliases                   | Description                                                                     |
| :--------- | :------------- | :------------------------ | :------------------------------------------------------------------------------ |
| `/add`     | `/add <path>`  | —                         | Add a specific file or entire directory to the active session context.          |
| `/drop`    | `/drop <path>` | —                         | Remove a file or directory from the active session context.                     |
| `/reset`   | `/reset`       | `/clear-history`, `/wipe` | Clear conversation history, loaded context files, and token counters.           |
| `/context` | `/context`     | —                         | Display loaded files, session turns, workspace path, and token usage estimates. |

### ⚡ Execution Modes

| Command   | Usage             | Aliases              | Description                                                                     |
| :-------- | :---------------- | :------------------- | :------------------------------------------------------------------------------ |
| `/plan`   | `/plan <prompt>`  | —                    | Formulate an architectural plan inside `<plan>` tags without writing any files. |
| `/heavy`  | `/heavy <prompt>` | `/deep`, `/hw`       | Bypass streaming racing and execute exclusively with the Heavyweight model.     |
| `/fast`   | `/fast <prompt>`  | `/light`, `/quick`   | Bypass streaming racing and execute exclusively with the Lightweight model.     |
| `/review` | `/review <file>`  | `/audit`, `/inspect` | Perform a deep code review (security, edge cases, bugs) without modifying code. |

### 🛡️ Safety & Git

| Command   | Usage     | Aliases   | Description                                                                   |
| :-------- | :-------- | :-------- | :---------------------------------------------------------------------------- |
| `/undo`   | `/undo`   | `/revert` | Revert the last file modification made by the AI using in-memory snapshots.   |
| `/diff`   | `/diff`   | —         | Inspect colorized terminal diff of uncommitted Git changes in the workspace.  |
| `/commit` | `/commit` | `/ci`     | Analyze current git diff, generate a conventional commit message, and commit. |

### ⚙️ System

| Command   | Usage        | Aliases             | Description                                                                         |
| :-------- | :----------- | :------------------ | :---------------------------------------------------------------------------------- |
| `/help`   | `/help`      | `/h`, `/commands`   | Print a clean, categorized table of all registered slash commands.                  |
| `/tokens` | `/tokens`    | `/stats`, `/usage`  | View token consumption statistics (prompt tokens, completion tokens, turns).        |
| `/run`    | `/run <cmd>` | `/sh`, `/exec`      | Execute a shell command directly in the workspace directory (e.g. `/run npm test`). |
| `/config` | `/config`    | `/setup`, `/apikey` | View configuration path or update your `NVIDIA_API_KEY`.                            |
| `/clear`  | `/clear`     | `/cls`              | Clear the terminal viewport and re-render the MachCode banner.                      |
| `/exit`   | `/exit`      | `/quit`, `/q`, `:q` | Gracefully exit the interactive REPL session (also accessible via `Ctrl+C`).        |

---

## 🏗️ Architecture Map

```text
machcode/
├── bin/
│   └── machcode.ts          # CLI binary & entry point (Commander.js -> startRepl)
├── src/
│   ├── commands/            # Scalable Command Registry & Slash Command implementations
│   │   ├── types.ts         # SlashCommand, CommandContext & FileSnapshot interfaces
│   │   ├── commandHandler.ts# Dynamic CommandRegistry dispatcher (zero giant switch statements)
│   │   ├── context.ts       # Context & Memory commands (/add, /drop, /reset, /context)
│   │   ├── execution.ts     # Execution Modes (/plan, /heavy, /fast, /review)
│   │   ├── git.ts           # Safety & Git commands (/undo, /diff, /commit)
│   │   ├── system.ts        # System commands (/help, /tokens, /run, /config, /clear, /exit)
│   │   └── index.ts         # Registry initializer & command aggregator
│   ├── config/              # Configuration manager (~/.machcode/config.json)
│   ├── engine/
│   │   ├── streamRacer.ts   # Streaming Handoff Racing Engine with AbortControllers
│   │   └── executor.ts      # Surgical code applier, write_file executor & onBeforeWrite snapshots
│   ├── prompts/
│   │   └── sniper.ts        # Zero-chatter, anti-hallucination "Sniper" system prompt
│   ├── tools/
│   │   ├── index.ts         # OpenAI tool calling schemas (read_file, write_file)
│   │   └── nvidiaSkills.ts  # Automatic NVIDIA/skills catalog loader & caching
│   ├── utils/
│   │   └── streamParser.ts  # Stream state machine (hides <plan>, handles QUESTION:)
│   └── index.ts             # REPL loop (startRepl) & runMachCode orchestrator
├── package.json
└── tsconfig.json
```

- **`src/engine/streamRacer.ts`**: Connects concurrently to SSE chat completions endpoints. Choreographs the 3-second handoff race, monitors token arrival, and cleans terminal lines via ANSI sequences when upgrading streams.
- **`src/commands/commandHandler.ts`**: Dynamic registry mapping command names and aliases to modular handlers without hardcoded switch-case structures.
- **`src/prompts/sniper.ts`**: The hyper-disciplined system prompt enforcing concise, zero-filler output, mandatory `// file: <path>` code fence headers, and the Stop & Ask protocol.
- **`src/engine/executor.ts`**: Parses code blocks, validates file boundaries, invokes pre-write snapshot hooks for `/undo`, and generates formatted modification summaries.
- **`src/utils/streamParser.ts`**: Chunk-level stream parser. Safely isolates `<plan>` tags to `debug.log`, handles partial tag splits across network packets, and triggers yellow clarification prompts when `QUESTION:` is detected.

---

## 🧪 Testing

MachCode ships with a comprehensive test suite covering the streaming racer, executor, tool schemas, Stop & Ask loops, multi-turn REPL interactions, and slash command execution:

```bash
# Run the complete test suite
pnpm test

# Run TypeScript compilation check
pnpm build

# Run ESLint & Prettier
pnpm lint
pnpm format:check
```

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the repository on GitHub.
2. Create a feature branch: `git checkout -b feature/my-new-feature`
3. Ensure all tests pass: `pnpm test && pnpm build`
4. Commit your changes: `git commit -m 'feat: add amazing feature'`
5. Push to the branch: `git push origin feature/my-new-feature`
6. Submit a Pull Request.

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for complete license details.
