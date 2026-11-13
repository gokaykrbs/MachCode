# ⚡ MachCode User Guide & Documentation

<p align="center">
  <strong>Multi-Model Parallel Racing AI Coding & Q&A CLI Powered by NVIDIA NIM</strong><br />
  <em>Antigravity / Claude Code / OpenCode grade terminal assistant powered by full-pool parallel LLM racing across 57+ NVIDIA NIM models (21+ AI providers), adaptive Plan & Build modes, surgical file editing, and snapshot rollbacks.</em>
</p>

<p align="center">
  <a href="README.tr.md">🇹🇷 Türkçe Kullanım Kılavuzu</a> | <a href="README.md">🇬🇧 English Documentation</a>
</p>

<p align="center">
  <a href="https://github.com/gokaykrbs/MachCode/releases"><img src="https://img.shields.io/badge/version-v0.1.0-blue.svg?style=flat-square" alt="version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="https://github.com/gokaykrbs/MachCode/actions"><img src="https://img.shields.io/badge/tests-109%2F109%20passing-brightgreen.svg?style=flat-square" alt="Tests Passing" /></a>
  <a href="https://build.nvidia.com"><img src="https://img.shields.io/badge/NVIDIA%20NIM-57%2B%20Models%20Racing-76B900.svg?style=flat-square&logo=nvidia" alt="NVIDIA NIM" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.6%20Strict-blue.svg?style=flat-square&logo=typescript" alt="TypeScript" /></a>
  <a href="#"><img src="https://img.shields.io/badge/REPL-Interactive%20Q%26A%20%2B%20Code-cyan.svg?style=flat-square" alt="REPL Mode" /></a>
</p>

---

## 📑 Table of Contents
1. [Architectural Philosophy](#-architectural-philosophy)
2. [Installation & Quick Start](#-installation--quick-start)
3. [Dual Operating Modes: Plan & Build](#-dual-operating-modes-plan--build)
4. [Streaming Racing Engine & Fair Balancing](#-streaming-racing-engine--fair-balancing)
5. [Model Steering & Routing Commands](#-model-steering--routing-commands)
6. [Specialized NVIDIA Subagents](#-specialized-nvidia-subagents)
7. [Surgical Code Editing, Diff Approval & Snapshots](#-surgical-code-editing-diff-approval--snapshots)
8. [Session Persistence & Context Management](#-session-persistence--context-management)
9. [Official NVIDIA Agent Skills & MCP Bridge](#-official-nvidia-agent-skills--mcp-bridge)
10. [Command Reference (29 Slash Commands)](#-command-reference-29-slash-commands)
11. [Troubleshooting & FAQ](#-troubleshooting--faq)

---

## 💡 Architectural Philosophy

Traditional terminal AI tools bottleneck on a single proprietary model. When that model suffers from cold starts, queue delays, or 10-second Time-to-First-Token (TTFT) spikes, your workflow grinds to a halt.

**MachCode** solves this by leveraging **NVIDIA Build (NIM)** to race all usable generative models across your API key concurrently (**Streaming Handoff Racing**). It locks onto the first model that emits a real content token and immediately aborts the remaining streams.

```text
                                 User Prompt / Instruction
                                            │
                                            ▼
                     [Parallel Multi-Model Race: StrongPool (57+ Models)]
           (Moonshot Kimi K3.1, DeepSeek R1, Qwen Coder, Llama 3.1 405B, Nemotron...)
                                            │
              ┌─────────────────────────────┴─────────────────────────────┐
              │ First Model Emits Real Content Token (200 OK)             │ All Fail / 10s Timeout
              ▼                                                           ▼
    [Instant Lock & Clean Stream]                               [WeakPool Fallback Race]
    • Buffers reasoning_content into <plan>                     • Fast lightweight pool race
    • Locks onto winning model & streams cleanly                • Guarantees resilient response
    • Aborts all other 56 pending HTTP streams                  • Never leaves user hanging
    • Displays 🏁 Race Winner & latency telemetry
```

---

## 📦 Installation & Quick Start

### Prerequisites
- **Node.js**: `>= 18.0.0` (Node 20+ recommended)
- **Package Manager**: `npm` or `pnpm`
- **NVIDIA Build (NIM) API Key**: Obtain a free key from [build.nvidia.com](https://build.nvidia.com) (`nvapi-...`).

### 1. Global Installation
```bash
# Via NPM
npm install -g machcode

# Or from source
git clone https://github.com/gokaykrbs/MachCode.git
cd MachCode
pnpm install
pnpm run build
pnpm link --global
```

### 2. Configure Your API Key
Launch MachCode from any workspace:

```bash
mach
```

If no key is configured, MachCode prompts you interactively and securely persists it to `~/.machcode/config.json`. You can also configure it via:
```bash
# Option A: In-session configuration
mach> /config key nvapi-your-key-here

# Option B: Environment variable
export NVIDIA_API_KEY="nvapi-your-key-here"  # macOS / Linux
$env:NVIDIA_API_KEY="nvapi-your-key-here"     # Windows PowerShell

# Option C: .env file
cp .env.example .env
```

---

## 🔄 Dual Operating Modes: Plan & Build

Switch between modes anytime by pressing the `Tab` key or typing `/mode`:

```text
[PLAN]  --> Safe Read-Only Mode: Codebase exploration, architectural blueprints, no writes.
[BUILD] --> Full Autonomous Agent: Surgical edits, diff previews, tests, and bash execution.
```

### 1. Plan Mode (`/mode plan` or `Tab`)
- Inspects repositories, diagnoses bugs, and produces architectural plans.
- Restricted to read-only tools (`read_file`, `list_directory`, `glob`, `grep`).
- **Never** modifies files or runs destructive terminal commands.

### 2. Build Mode (`/mode build` or `Tab`)
- Implements features, performs surgical multi-file edits, and executes tests.
- Uses `edit_file`, `write_file`, `apply_diff`, and `run_command`.
- Presents interactive, colorized diff confirmation cards before modifying workspace files.

---

## 🏎️ Streaming Racing Engine & Fair Balancing

### Pool Classification
- **StrongPool (Frontier Reasoning & Heavy Coding):**
  - `moonshotai/kimi-k3.1` & `kimi-k2.6`
  - `deepseek-ai/deepseek-r1` & `deepseek-coder-33b`
  - `qwen/qwen2.5-coder-32b-instruct`
  - `meta/llama-3.1-405b-instruct` & `codellama-70b`
  - `nvidia/nemotron-4-340b-instruct` & `nemotron-70b`
- **WeakPool (Ultra-Fast Fallback & Small Models):**
  - `poolside/laguna-xs-2.1`
  - `minimaxai/minimax-m3.1-flash`
  - `openai/gpt-oss-20b`
  - `nvidia/nemotron-3.5-bolt-e4b`

### Fair Balancing & Micro-Model Handicap
Frontier reasoning models (`Kimi K3.1`, `DeepSeek R1`) emit internal chain-of-thought (`reasoning_content`) before their first actual answer token. MachCode buffers internal reasoning into `<plan>` to keep the terminal output clean.

To prevent micro-models (`laguna-xs`, `flash`, `bolt-e4b`) from winning in 50ms before reasoning models can finish their thoughts:
1. Micro and extra-small models are segregated into the **WeakPool**.
2. When racing alongside frontier models, ultra-fast models are assigned a **1.6-second fair handicap delay**.
3. Heavy tasks (architecture, refactoring, algorithms) automatically trigger **Priority Heavy Routing** to `Kimi K3.1` and `DeepSeek R1`.

---

## 🎯 Model Steering & Routing Commands

Take direct control of model dispatching when you want specific foundation capabilities:

### 1. `/heavy <prompt>` — Direct Frontier Reasoning
Bypasses racing and routes exclusively to your top Heavyweight model (`moonshotai/kimi-k3.1`):
```bash
mach> /heavy Analyze potential race conditions and deadlock vectors in this event loop
```

### 2. `/fast <prompt>` — Instant Lightweight Dispatch
Bypasses racing for trivial lookups, routing to the fastest lightweight model:
```bash
mach> /fast Write a bash one-liner to find all *.log files older than 7 days
```

### 3. `/model [id|reset]` — Pin a Specific Model
Pins all subsequent queries in the session to a chosen NIM model:
```bash
# Pin to Moonshot Kimi K3.1:
mach> /model moonshotai/kimi-k3.1

# Pin to DeepSeek R1:
mach> /model deepseek-ai/deepseek-r1

# Pin to Qwen 2.5 Coder 32B:
mach> /model qwen/qwen2.5-coder-32b-instruct

# Unpin and return to multi-model parallel racing:
mach> /model reset
```

### 4. `/race` — Live Latency & TPS Benchmark
Races active NIM models simultaneously on a benchmark query and prints a comparative telemetry report:
```bash
mach> /race
```

### 5. `/config refresh` — Dynamic Catalog Discovery
Fetches the latest active models from NVIDIA NIM and updates your model pools automatically:
```bash
mach> /config refresh
```

---

## 🤖 Specialized NVIDIA Subagents

MachCode bundles 5 specialized subagents natively bound to the NVIDIA NIM catalog. Invoke them using `@<name>` mentions or pin them using `/agent <name>`:

| Subagent | Mention | Mode | Preferred NIM Models | Role & Capabilities |
| :--- | :--- | :---: | :--- | :--- |
| **Architect** | `@architect` | `PLAN` | Kimi K3.1, DeepSeek R1, Llama 3.1 405B | System architecture, RFC design, database schemas, modular boundaries, UML. |
| **Coder** | `@coder` | `BUILD` | Qwen 2.5 Coder 32B, DeepSeek-Coder, Llama 3.3 70B | Surgical code implementation, precise git diffs, clean zero-chatter code generation. |
| **Tester** | `@tester` | `BUILD` | Qwen 2.5 Coder, Mixtral 8x22B, Llama 3.3 70B | Unit & integration tests, boundary fuzzing, mock assertions, regression suites. |
| **Reviewer** | `@reviewer` | `PLAN` | DeepSeek R1, Nemotron 70B, Llama 3.1 405B | Strict code review, security auditing (OWASP), memory leaks, performance profiling. |
| **NVIDIA Specialist** | `@nvidia` | `BUILD` | DeepSeek R1, Nemotron 70B, Llama 3.1 405B | GPU acceleration (CUDA C++, TensorRT-LLM, cuDF, cuOpt, Triton, DALI). |

**Examples:**
```bash
mach> @architect Design a distributed queue architecture for our webhook processor
mach> @coder Implement the AES-256-GCM encryption helper in src/crypto/cipher.ts
mach> @tester Generate a complete node:test suite for src/crypto/cipher.ts
mach> @reviewer Audit src/engine/executor.ts for command injection and path traversal vulnerabilities
mach> @nvidia Optimize this reduction kernel using CUDA warp shuffles and shared memory tiling
```

---

## 🛡️ Surgical Code Editing, Diff Approval & Snapshots

### 1. Interactive Approval Gate
Before modifying or creating any file, MachCode presents an interactive, colorized diff preview:
```text
══════════════════════════════════════════════════════════════════
  FILE EDIT PROPOSAL: src/config.ts (+3 / -1 lines)
══════════════════════════════════════════════════════════════════
  @@ -12,3 +12,5 @@
  - const timeout = 5000;
  + const timeout = 10000;
  + export const RETRY_COUNT = 3;

[Y]es / [n]o / [a]ll / [d]iff ?
```
- Toggle policy anytime:
  - `/approve ask` (Default: Always confirm with diff card)
  - `/approve auto` (Auto-apply: Useful for rapid prototyping)

### 2. Multi-File Snapshot Rollback
MachCode captures filesystem snapshots before every mutation:
```bash
# Revert the most recent file change:
mach> /undo

# Revert all changes made to a specific file:
mach> /undo src/config.ts

# Revert ALL changes made during this session:
mach> /undo all

# View chronological snapshot history:
mach> /snapshots
```

---

## 💾 Session Persistence & Context Management

All work is automatically recorded in `~/.machcode/sessions/`. Sessions survive terminal restarts, crashes, and power outages:

```bash
# Save current session checkpoint:
mach> /save milestone-auth-complete

# List recorded sessions:
mach> /sessions

# Restore a previous session:
mach> /resume mc_46syblac
mach> /resume latest

# Launch MachCode directly into a saved session:
mach --resume
mach --resume milestone-auth-complete
```

### Context Summarization
When conversations approach the model's context window limit, MachCode's summarization engine condenses earlier turns automatically, preserving critical state without token overflow.

---

## 🧩 Official NVIDIA Agent Skills & MCP Bridge

### 1. Official NVIDIA Skills
Integrated directly with [`NVIDIA/skills`](https://github.com/NVIDIA/skills):
- `/skills`: Catalog of official NVIDIA guides.
- `/cuopt`: GPU-accelerated routing and numerical optimization (LP, MILP).
- `/cudf`: GPU DataFrames and pandas acceleration.
- `/cudaq`: Quantum-classical hybrid programming.

### 2. Model Context Protocol (MCP) Bridge
Connect SQLite databases, GitHub integrations, and custom MCP tools via `.machcode/mcp.json`:
```bash
mach> /mcp list
mach> /mcp reload
```

---

## 📖 Command Reference (29 Slash Commands)

| Command | Usage | Category | Description |
| :--- | :--- | :--- | :--- |
| `/ask` | `/ask <question>` | Execution | Conversational Q&A without modifying files or running commands. |
| `/plan` | `/plan <prompt>` | Execution | Switch to Plan Mode or generate an architectural blueprint. |
| `/mode` | `/mode [plan\|build]` | Execution | Toggle between Plan (read-only) and Build (agent) modes. |
| `/heavy` | `/heavy <prompt>` | Execution | Bypass race and route directly to Heavyweight reasoning model. |
| `/fast` | `/fast <prompt>` | Execution | Bypass race and route directly to Lightweight fast model. |
| `/review` | `/review <file>` | Execution | Run an in-depth security, bug, and edge-case code review. |
| `/agent` | `/agent [name\|reset]` | Subagents | View, switch, or pin specialized NVIDIA NIM subagents. |
| `/model` | `/model [id\|reset]` | System | Pin queries to a specific model or return to the racing pool. |
| `/race` | `/race` | System | Run a live parallel latency, TTFT, and TPS benchmark. |
| `/config` | `/config [refresh\|key]`| System | Update API key or refresh NIM catalog pools. |
| `/approve` | `/approve [ask\|auto]` | Safety | Toggle interactive diff approval before writes. |
| `/undo` | `/undo [file\|all]` | Safety | Rollback file modifications made by the AI. |
| `/snapshots`| `/snapshots` | Safety | List chronological file mutation snapshots. |
| `/search` | `/search <query>` | Context | High-speed multi-file regex search across the workspace. |
| `/add` | `/add <path>` | Context | Add a specific file or folder to the active session context. |
| `/drop` | `/drop <path>` | Context | Remove a file or folder from session context. |
| `/save` | `/save [name]` | Session | Save current session snapshot to disk. |
| `/sessions` | `/sessions` | Session | List recorded session checkpoints for this workspace. |
| `/resume` | `/resume [id\|latest]` | Session | Restore a past session and resume turns. |
| `/theme` | `/theme [name]` | UI | Switch terminal theme (`tokyo-night`, `matrix`, `dracula`...). |
| `/status` | `/status` | UI | Display live session diagnostics card and status bar. |
| `/tokens` | `/tokens` | Diagnostics | Display session prompt and output token usage. |
| `/diff` | `/diff` | Git | View colorized terminal diff of uncommitted git changes. |
| `/commit` | `/commit` | Git | Generate conventional commit message and commit. |
| `/branch` | `/branch [name]` | Git | Show current git branch or switch branches. |
| `/run` | `/run <cmd>` | System | Execute a shell command directly in the workspace. |
| `/clear` | `/clear` | UI | Clear the terminal screen. |
| `/help` | `/help` | Help | Display cheat sheet of all available commands. |
| `/exit` | `/exit` | System | Gracefully exit the MachCode CLI. |

---

## ❓ Troubleshooting & FAQ

### 1. Why was `poolside/laguna-xs` winning every race?
`laguna-xs` is a tiny micro-model optimized for sub-100ms TTFT. Because frontier models like `Kimi K3.1` and `DeepSeek R1` perform chain-of-thought reasoning before emitting their first content token, micro-models were winning solely on latency. MachCode balances this by:
- Moving micro-models to the `WeakPool`.
- Enforcing a 1.6s fair handicap delay when competing against frontier reasoning models.

### 2. How do I use Moonshot Kimi K3.1 directly?
You can dispatch to it instantly via:
- One-off query: `mach> /heavy [your query]`
- Pinned session: `mach> /model moonshotai/kimi-k3.1`

### 3. How do I update my NVIDIA API Key?
Inside the MachCode terminal:
```bash
mach> /config key nvapi-your-new-key-here
```

---

## 📄 License
Distributed under the **[MIT License](LICENSE)**. See `LICENSE` for details.
See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.
