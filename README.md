# ⚡ MachCode

<p align="center">
  <strong>Multi-Model Parallel Racing AI Coding & Q&A CLI</strong><br />
  <em>Antigravity / Claude Code / OpenCode grade interactive terminal assistant powered by full-pool parallel LLM racing across 57+ NVIDIA NIM models (21+ AI providers), adaptive Q&A + surgical code editing, and a continuous interactive REPL.</em>
</p>

<p align="center">
  <a href="https://github.com/gokaykrbs/MachCode/releases"><img src="https://img.shields.io/badge/version-v0.1.0-blue.svg?style=flat-square" alt="version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="https://github.com/gokaykrbs/MachCode/actions"><img src="https://img.shields.io/badge/tests-77%2F77%20passing-brightgreen.svg?style=flat-square" alt="Tests Passing" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.6-blue.svg?style=flat-square&logo=typescript" alt="TypeScript" /></a>
  <a href="https://build.nvidia.com"><img src="https://img.shields.io/badge/NVIDIA%20NIM-57%2B%20Models%20Racing-76B900.svg?style=flat-square&logo=nvidia" alt="NVIDIA NIM" /></a>
  <a href="#"><img src="https://img.shields.io/badge/REPL-Interactive%20Q%26A%20%2B%20Code-cyan.svg?style=flat-square" alt="REPL Mode" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Phases-0%20to%205%20Complete-success.svg?style=flat-square" alt="Phases Completed" /></a>
</p>

---

> _"Every model in your API key races in parallel. The fastest intelligence wins. Zero hallucinations, zero wait."_

**MachCode** is a terminal-native AI coding and conversational Q&A CLI engineered for high-velocity software development. Built in the spirit of **Antigravity CLI**, **Claude Code**, and **OpenCode**, MachCode eliminates single-model bottlenecks by firing **all usable generative AI models available in your NVIDIA Build (NIM) API key** (57+ models across 21+ providers such as **OpenAI, Google Gemma, DeepSeek, Qwen, MiniMax, Mistral, Meta Llama, Moonshot Kimi, Microsoft Phi, Z-AI GLM, NVIDIA Nemotron**) in parallel, locking onto the first model that emits a real answer token, and immediately aborting the remaining streams.

---

## 🎯 Implementation Roadmap (All Phases Completed)

| Phase | Title | Status | Highlights & Deliverables |
| :--- | :--- | :---: | :--- |
| **Faz 0** | **Hazırlık (Preparation)** | ✅ Completed | Repository architecture, TypeScript 5.6 strict ESM setup, Node.js test runner harness, NVIDIA NIM multi-provider model discovery. |
| **Faz 1** | **Çekirdek Döngü (Core Loop)** | ✅ Completed | Parallel model racing engine (`streamRacer.ts`), TTFT token locking, `<plan>` reasoning separation, read-only tools (`read_file`, `list_dir`, `glob`, `grep`), Plan Mode. |
| **Faz 2** | **Düzenleme & Komut (Editing & Commands)** | ✅ Completed | Surgical file operations (`edit_file`, `write_file`, `run_command`), interactive colorized git diff preview `[Y/n/a/d]`, permission security layer, path guards, Build Mode. |
| **Faz 3** | **Terminal Deneyimi (Terminal UX)** | ✅ Completed | Antigravity-style responsive Status Bar (`[BUILD] │ 🏁 57 models │ 📁 MachCode │ 🌿 main │ 🪙 1.4k tokens`), 7 high-fidelity color themes (`/theme`), `@file` mentions with live auto-expansion, model selector (`/model`), Tab mode toggling. |
| **Faz 4** | **Dayanıklılık (Resilience & Sessions)** | ✅ Completed | Full session persistence in `~/.machcode/sessions/`, `/save`, `/sessions`, `/resume`, `--resume` CLI flag, 20-step loop budget guard, context summarization engine to prevent context window overflow, Esc interruption recovery. |
| **Faz 5** | **Paketleme & Dağıtım (Packaging)** | ✅ Completed | Global bin entrypoints (`mach`, `machcode`), cross-project execution from any directory (`npm link`), zero-config CLI argument parser (`--resume`, `--mode`, `--theme`, `--yes`), full documentation. |

---

## 💡 The Problem & The Solution

### 🛑 The Problem: Single-Model Latency Spikes & Rigid CLIs

1. **The Single-Provider Bottleneck:** Deep reasoning and high-parameter coding models (70B–550B) deliver great answers, but frequently suffer from queue delays, cold starts, and 5–15 second Time-to-First-Token (TTFT) spikes.
2. **Hidden Reasoning Leaks:** Many modern reasoning models emit internal chain-of-thought (`reasoning_content`) before actual answer tokens, either polluting the terminal or prematurely winning latency races before producing usable output.
3. **Code-Only vs. Chat Friction:** Traditional terminal tools either force every response into file overwrites or lack surgical workspace editing (`read_file` / `write_file`) and undo snapshots.

### ⚡ The Solution: Full-Pool Parallel Model Racing & Adaptive Dual-Mode REPL

MachCode re-engineers the terminal AI loop around core pillars:

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

#### 2. Adaptive Dual-Mode Intelligence (Conversational Q&A + Agentic Coding)

- **Plan Mode (`/mode plan` / Tab key):** Safe read-only inspection. The agent can search, list, and read files across any folder or drive without modifying files or running bash.
- **Build Mode (`/mode build` / Tab key):** Full autonomous agent capabilities. Performs multi-step tool calls, surgical file editing, and test execution with interactive diff confirmation.

#### 3. Responsive Antigravity-Style Status Bar & 7 Color Themes

MachCode includes a live terminal Status Bar and 7 beautiful themes:
- `default`: Clean cyan, yellow, and subtle contrast
- `tokyo-night`: Indigo night, neon purple, soft pastel cyan
- `dracula`: Classic vampire purple, pink, lime green
- `matrix`: Phosphor emerald green cyberpunk aesthetic
- `monokai`: Warm yellow, vibrant pink, mint green
- `cyberpunk`: Electric yellow, neon cyan, hot pink
- `minimal`: High-clarity monochrome typography

---

## ✨ Key Features

- 🏁 **57+ Model Parallel Racing Engine:** Simultaneously races all usable generative models across 21+ AI providers in your NVIDIA NIM account and locks onto the fastest responder.
- 💡 **Interactive Autocomplete (`/` & `@`):** Typing `/` displays a navigable dropdown card for slash commands and NVIDIA skills. Typing `@` suggests and auto-completes workspace files.
- 📎 **`@file` Context Mentions:** Mention any file in your prompt (e.g. `@src/index.ts`) to automatically embed its content into the conversation.
- 🛡️ **Interactive Approval:** Colorized line diff preview cards before creating or modifying any file with `[Y]es / [n]o / [a]ll / [d]iff` choices.
- 💾 **Session Persistence & Resumption:** Auto-saves session state to `~/.machcode/sessions/`. Resume anytime via `/resume <id>` or `mach --resume [id]`.
- 🧠 **Context Summarization:** Automatically condenses conversation turns when token threshold is reached, protecting the model context window.
- 🛑 **20-Step Loop Budget Guard:** Prevents runaway agent loops with optional user confirmation to continue.
- 🎨 **Theme Engine (`/theme`):** Instant runtime theme switching across 7 terminal color palettes.
- 📊 **Status Bar (`/status`):** Live diagnostics showing active mode, model pool, current directory, git branch, tokens, and approval policy.
- 🧩 **Native NVIDIA Agent Skills:** Automatic integration with official [`NVIDIA/skills`](https://github.com/NVIDIA/skills) catalog.
- 🔌 **Model Context Protocol (MCP) Bridge:** Connect external tool servers and local JSON MCP definitions via `.machcode/mcp.json` and `/mcp`.
- 🔍 **High-Performance Multi-File Code Search (`/search`):** Fast regex and text scanner with context lines, file pattern filters, and secret protections.
- 🔄 **Unified Diff Patch Applicator (`apply_diff`):** Resilient chunk and hunk parser with offset tolerance and fuzzy line matching fallback.
- 🛡️ **Multi-File Snapshot Rollback (`/snapshots`, `/undo [file|all]`):** Chronological file mutation snapshots allowing selective or full rollbacks.
- 🏎️ **Live Parallel Benchmark (`/race`):** Parallel model latency, TTFT (time-to-first-token), and TPS (tokens per second) profiler.

---

## 📦 Installation

### Prerequisites

- [Node.js](https://nodejs.org/) `>= 18.0.0`
- [npm](https://npmjs.com/) or [pnpm](https://pnpm.io/)
- An [NVIDIA Build (NIM)](https://build.nvidia.com) API key (`nvapi-...`)

### Global Setup

```bash
# 1. Clone the repository
git clone https://github.com/gokaykrbs/MachCode.git
cd MachCode

# 2. Install dependencies & build
npm install
npm run build

# 3. Link globally (enables the `mach` and `machcode` commands everywhere)
npm link
```

---

## 🚀 Usage

### 1. Launch the Interactive REPL

Run `mach` in any project folder:

```bash
mach
```

### 2. Resume Previous Session

```bash
# Resume latest session
mach --resume

# Resume specific session by ID
mach --resume mc_9xyz123
```

### 3. CLI Options

```bash
mach --help
mach -f src/utils/math.ts "Add Fibonacci helper function" -y
mach --mode plan "Analyze the codebase architecture"
mach --theme tokyo-night
```

---

## 📖 Command Reference (28 Slash Commands)

| Command | Usage | Aliases | Category | Description |
| :--- | :--- | :--- | :--- | :--- |
| `/ask` | `/ask <question>` | `/chat`, `/qna` | Execution | Ask a question or chat in read-only mode without modifying files. |
| `/plan` | `/plan <prompt>` | — | Execution | Generate an architectural blueprint or switch to Plan Mode. |
| `/mode` | `/mode [plan\|build\|toggle]` | `/m` | Execution | Switch between Plan (read-only) and Build (full agent) modes. |
| `/build` | `/build` | `/dev`, `/write` | Execution | Switch session directly to Build Mode. |
| `/heavy` | `/heavy <prompt>` | `/deep`, `/hw` | Execution | Bypass racing and execute using exclusively the Heavyweight model. |
| `/fast` | `/fast <prompt>` | `/light`, `/quick`| Execution | Bypass racing and execute using exclusively the Lightweight model. |
| `/review` | `/review <file>` | `/audit` | Execution | Run an in-depth security, bug, and edge-case code review. |
| `/agent` | `/agent <task>` | `/auto`, `/loop` | Execution | Run in autonomous multi-step agent mode across all drives. |
| `/skills` | `/skills [name] [task]`| `/skill` | Skills | List or execute tasks with official NVIDIA Agent Skills. |
| `/cuopt` | `/cuopt [task]` | — | Skills | cuOpt shortcut: GPU vehicle routing & LP/MILP optimization. |
| `/cudf` | `/cudf [task]` | — | Skills | cuDF shortcut: GPU DataFrames & pandas acceleration. |
| `/cudaq` | `/cudaq [task]` | — | Skills | CUDA-Q shortcut: Quantum-classical hybrid programming. |
| `/approve` | `/approve [ask\|auto]` | `/confirm` | Safety & Git | Toggle interactive diff approval before modifying files. |
| `/undo` | `/undo [file\|all]` | `/revert` | Safety & Git | Revert file modifications made by the AI (last, specific, or all). |
| `/snapshots`| `/snapshots` | `/snaps`, `/history`| Safety & Git | View chronological list of file modification snapshots. |
| `/branch` | `/branch [name]` | `/branches` | Safety & Git | Show current git branch or switch branches. |
| `/diff` | `/diff` | — | Safety & Git | Show colorized terminal diff of uncommitted git changes. |
| `/commit` | `/commit` | `/ci` | Safety & Git | Generate conventional commit message and commit changes. |
| `/search` | `/search <query>` | `/grep`, `/find` | Context | Fast multi-file regex and text search across the workspace. |
| `/add` | `/add <path>` | — | Context | Add a specific file or folder to the active session context. |
| `/drop` | `/drop <path>` | — | Context | Remove a file or folder from session context. |
| `/save` | `/save [name]` | `/snapshot` | Context | Save current session snapshot to disk for later resumption. |
| `/sessions`| `/sessions` | `/history-list` | Context | List all saved session checkpoints for this workspace. |
| `/resume` | `/resume [id\|latest]` | `/restore` | Context | Resume a past session and restore turns, context & tokens. |
| `/status` | `/status` | `/sb`, `/bar` | System | Display interactive session diagnostics card and status bar. |
| `/theme` | `/theme [name]` | `/themes` | System | Switch terminal theme (tokyo-night, dracula, matrix, monokai...). |
| `/model` | `/model [id\|reset]` | `/models`, `/llm` | System | Pin queries to a specific model or view racing pools. |
| `/mcp` | `/mcp [reload\|list]` | `/servers` | System | Manage Model Context Protocol (MCP) servers and external tools. |
| `/race` | `/race` | `/benchmark` | System | Run a live parallel speed, TTFT, and TPS benchmark across AI models. |
| `/tokens` | `/tokens` | `/stats` | System | Show session token usage statistics. |
| `/run` | `/run <cmd>` | `/exec` | System | Execute a shell command directly in the workspace. |
| `/help` | `/help` | `/h` | System | Print table of all slash commands. |
| `/clear` | `/clear` | `/cls` | System | Clear the terminal screen. |
| `/exit` | `/exit` | `/quit`, `/q` | System | Gracefully exit the MachCode CLI. |

---

## 🧪 Testing

MachCode includes a comprehensive automated test suite covering all phases and features (`97/97` passing across 23 suites):

```bash
npm test
```

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.
