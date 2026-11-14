# ⚡ MachCode

<p align="center">
  <strong>The High-Velocity, Multi-Model AI Coding Assistant for Your Terminal</strong><br />
  <em>Powered by NVIDIA NIM. Races frontier AI models in parallel so you never wait for slow APIs. Includes full dual-mode operation (Plan & Build), surgical file editing, and instant rollbacks.</em>
</p>

<p align="center">
  <a href="README.tr.md">🇹🇷 Türkçe Kullanım Kılavuzu</a> | <a href="README.md">🇬🇧 English Documentation</a>
</p>

<p align="center">
  <a href="https://github.com/gokaykrbs/MachCode/releases"><img src="https://img.shields.io/badge/version-v0.1.0-blue.svg?style=flat-square" alt="version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="https://github.com/gokaykrbs/MachCode/actions"><img src="https://img.shields.io/badge/tests-110%2F110%20passing-brightgreen.svg?style=flat-square" alt="Tests Passing" /></a>
  <a href="https://build.nvidia.com"><img src="https://img.shields.io/badge/NVIDIA%20NIM-57%2B%20Models-76B900.svg?style=flat-square&logo=nvidia" alt="NVIDIA NIM" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.6-blue.svg?style=flat-square&logo=typescript" alt="TypeScript" /></a>
  <a href="#"><img src="https://img.shields.io/badge/CLI-Global%20Binary-cyan.svg?style=flat-square" alt="CLI" /></a>
</p>

---

## 📖 Welcome to MachCode

**MachCode** is an open-source, terminal-native AI coding assistant built for developers who want speed, safety, and precision. 

Instead of relying on a single AI model that might be slow or temporarily down, MachCode connects to **NVIDIA Build (NIM)** and fires requests across a pool of frontier generative models simultaneously. The first model to stream a real answer wins the race, and the rest are instantly cancelled. You get lightning-fast responses with zero waiting.

```text
                        Your Prompt / Instruction
                                   │
                                   ▼
        [Parallel Multi-Model Race Across Available AI Models]
         (DeepSeek, Kimi, Llama 3.1, Qwen Coder, Nemotron, Mistral...)
                                   │
        ┌──────────────────────────┴──────────────────────────┐
        │ Fastest Model Emits First Content Token             │ Network / Timeout
        ▼                                                     ▼
[Instant Lock & Clean Stream]                       [Fast Fallback Pool]
• Locks onto the fastest responder                  • Taps instant backup models
• Cancels remaining streams to save bandwidth       • You are never left waiting
• Streams cleanly to your terminal
```

---

## 🚀 Quick Start in 60 Seconds

### 1. Installation
Install MachCode globally using `npm` (or `pnpm`):

```bash
npm install -g machcode
```

*(Or clone and build from source: `git clone https://github.com/gokaykrbs/MachCode.git && cd MachCode && pnpm install && pnpm run build && npm link`)*

### 2. Launch
Run `mach` in any project folder:

```bash
mach
```

### 3. Set Your Free API Key
On your first launch, MachCode will prompt you for your NVIDIA Build API key. 
- You can get a free key with complimentary credits at **[build.nvidia.com](https://build.nvidia.com)**.
- You can also set it via environment variable:
  ```bash
  export NVIDIA_API_KEY="nvapi-your-key-here"     # macOS / Linux
  $env:NVIDIA_API_KEY="nvapi-your-key-here"        # Windows PowerShell
  ```

---

## 🧭 Core Concepts: How MachCode Works

### 1. Dual Operating Modes: Plan & Build
Switch modes anytime by pressing `Tab` or typing `/mode`:

| Mode | What it Does | When to Use It |
| :--- | :--- | :--- |
| **`[PLAN]`** | **Read-Only / Safe:** Inspects code, analyzes bugs, and writes architectural plans without touching your files. | Exploring unfamiliar repos, designing schemas, or asking general questions. |
| **`[BUILD]`** | **Active Agent:** Reads files, edits code, runs shell commands, and writes tests with your approval. | Implementing features, fixing bugs, and refactoring code. |

---

### 2. Human-in-the-Loop Safety & Diffs
You are always in control. Before MachCode creates or modifies any file, it presents a clear, colorized diff card:

```text
══════════════════════════════════════════════════════════════════
  PROPOSED FILE EDIT: src/server.ts (+2 / -1 lines)
══════════════════════════════════════════════════════════════════
  @@ -15,3 +15,4 @@
  - const port = 3000;
  + const port = process.env.PORT || 8080;
  + console.log(`Server listening on port ${port}`);

[Y]es (apply) / [n]o (reject) / [a]ll (approve all) / [d]iff (view full) ?
```

- **Approve (`y`)**: Applies the changes immediately.
- **Reject (`n`)**: Cancels the edit and lets you tell the AI what to change.
- **Undo (`/undo`)**: Made a mistake? Type `/undo` to instantly revert the file back to its exact previous state.

---

### 3. File Context & Mentions (`@file`)
Reference any file or folder directly in your prompt by typing `@`:
```bash
mach> How does authentication work in @src/auth/jwt.ts?
mach> Refactor @src/utils/math.ts and write tests in @tests/math.test.ts
```
MachCode automatically reads the referenced files and includes their contents in the conversation context.

---

## 🎛️ Controlling Models

MachCode's parallel racing engine gives you the fastest response by default. However, you can steer or pin models whenever you want:

### 1. Let the Fastest Model Answer (Default)
Just type your prompt normally. MachCode automatically races the available models in parallel:
```bash
mach> Create a debounce function in TypeScript with cancel support
```

### 2. Route to Deep Reasoning (`/heavy`)
For complex architectures, hard algorithms, or tricky refactors, bypass the race and send your task straight to a top-tier reasoning model:
```bash
mach> /heavy Analyze this database schema for potential race conditions and deadlocks
```

### 3. Route to Quick Answers (`/fast`)
For simple questions, syntax lookups, or shell commands:
```bash
mach> /fast How do I recursively delete all .DS_Store files in bash?
```

### 4. Pin a Specific Model (`/model`)
Want to work exclusively with a specific model for your entire session?
```bash
# Pin to any model by name:
mach> /model deepseek-ai/deepseek-r1
mach> /model qwen/qwen2.5-coder-32b-instruct

# Unpin and return to parallel racing:
mach> /model reset

# Sync live models directly from your NVIDIA account:
mach> /model refresh
```

### 5. Live Benchmark (`/race`)
Want to see which AI models are currently responding fastest on your connection?
```bash
mach> /race
```
MachCode sends a test prompt to all active models and displays a comparative speed table showing TTFT (Time to First Token) and TPS (Tokens Per Second).

---

## 🤖 Meet the Subagents

MachCode includes 5 built-in AI specialists. Call them directly by starting your prompt with `@<agent>` or switch to one permanently with `/agent <name>`:

| Subagent | Mention | Mode | Best For |
| :--- | :--- | :---: | :--- |
| **Architect** | `@architect` | `PLAN` | System design, database schemas, API specs, and project structure. |
| **Coder** | `@coder` | `BUILD` | Writing clean, robust code, fixing bugs, and implementing features. |
| **Tester** | `@tester` | `BUILD` | Writing unit tests, mocking dependencies, and fuzzing edge cases. |
| **Reviewer** | `@reviewer` | `PLAN` | Code review, spotting security vulnerabilities, and performance audits. |
| **NVIDIA Specialist** | `@nvidia` | `BUILD` | GPU acceleration, CUDA, TensorRT, cuDF, and high-performance computing. |

**Examples:**
```bash
mach> @architect How should we structure the tables for a multi-tenant SaaS app?
mach> @coder Implement rate limiting middleware using a sliding window algorithm
mach> @tester Write comprehensive unit tests for our auth service
mach> @reviewer Check src/api/payment.ts for security risks and edge cases
```

---

## 💾 Sessions & Workspaces

Never lose your work. MachCode automatically preserves your progress:

- **Save Checkpoints:** Type `/save [name]` anytime to bookmark your session state.
- **List Sessions:** Type `/sessions` to view all saved workspaces and checkpoints.
- **Resume Anytime:** 
  ```bash
  # Inside MachCode:
  mach> /resume latest
  mach> /resume my-feature-branch

  # Directly from terminal:
  mach --resume
  mach --resume my-feature-branch
  ```
- **Context Summarization:** As conversations grow long, MachCode automatically summarizes earlier turns in the background, keeping memory fresh without hitting token limits.

---

## 📖 Command Cheat Sheet

Type `/` in the terminal to open the interactive autocomplete menu, or use this reference:

| Command | Usage | Description |
| :--- | :--- | :--- |
| `/mode` | `/mode [plan\|build]` | Toggle between Plan (read-only) and Build (active agent) modes (or press `Tab`). |
| `/ask` | `/ask <question>` | Ask a question without making any file changes or running commands. |
| `/heavy` | `/heavy <prompt>` | Route directly to the deepest reasoning model available. |
| `/fast` | `/fast <prompt>` | Route directly to the fastest lightweight model. |
| `/model` | `/model [id\|reset\|refresh]` | View model pools, pin a specific model, or sync live with NVIDIA Build API. |
| `/race` | `/race` | Run a live parallel speed and latency benchmark across AI models. |
| `/review` | `/review <file>` | Perform an automated security, bug, and quality review on a file. |
| `/agent` | `/agent [name\|reset]` | Switch between specialized subagents (`@architect`, `@coder`, etc.). |
| `/undo` | `/undo [file\|all]` | Revert AI modifications (last edit, specific file, or full session). |
| `/snapshots`| `/snapshots` | View chronological history of file changes. |
| `/approve` | `/approve [ask\|auto]` | Toggle interactive diff confirmation before file edits. |
| `/search` | `/search <query>` | Fast regex search across all files in your project. |
| `/add` / `/drop` | `/add <file>` | Add or remove specific files from the permanent context window. |
| `/save` | `/save [name]` | Save current conversation and state as a named checkpoint. |
| `/sessions` | `/sessions` | List all saved sessions for this workspace. |
| `/resume` | `/resume [id\|latest]` | Restore a previous session and continue working. |
| `/theme` | `/theme [name]` | Switch UI theme (`tokyo-night`, `matrix`, `dracula`, `monokai`...). |
| `/status` | `/status` | Show live status bar and session diagnostics. |
| `/tokens` | `/tokens` | Display token usage statistics for the current session. |
| `/diff` | `/diff` | Show uncommitted Git changes in the workspace. |
| `/commit` | `/commit` | Automatically generate a conventional commit message and commit. |
| `/branch` | `/branch [name]` | Check current Git branch or switch branches. |
| `/run` | `/run <command>` | Execute a shell command directly inside your workspace. |
| `/config` | `/config [key\|refresh]` | View or update your NVIDIA API key and model configuration. |
| `/clear` | `/clear` | Clear the terminal screen. |
| `/help` | `/help` | Print the command help card. |
| `/exit` | `/exit` | Gracefully exit MachCode (`q` or `Ctrl+C`). |

---

## ❓ Frequently Asked Questions (FAQ)

### 1. What is MachCode and how is it different from other AI tools?
Most AI coding tools send your request to a single model provider (e.g., only Claude or only OpenAI). If that service is experiencing traffic spikes or cold starts, you have to wait. 

MachCode connects to **NVIDIA Build (NIM)**, which hosts dozens of top-tier models (DeepSeek, Llama, Qwen, Kimi, Mistral, Nemotron, etc.). MachCode sends your prompt to multiple models at the same time and locks onto whichever model answers first. You get maximum speed and zero downtime.

### 2. Can I use a specific model instead of racing?
Yes! If you prefer a particular model (for example, DeepSeek R1 for logic or Qwen 2.5 Coder for code), you can pin it anytime:
```bash
mach> /model deepseek-ai/deepseek-r1
```
Whenever you want to return to parallel racing, simply type `/model reset`.

### 3. Is my code safe? Does MachCode edit files without permission?
By default, **MachCode never modifies any file without your explicit approval**. Whenever the AI wants to write or update code, it presents an interactive diff preview card and waits for your confirmation (`[Y]es / [n]o`). You can also undo any change at any time using `/undo`.

### 4. How do I get an API key?
Visit **[build.nvidia.com](https://build.nvidia.com)**, create a free account, and generate an API key (`nvapi-...`). NVIDIA provides generous free credits to get started. Once you have your key, run `mach` and paste it in.

### 5. What happens when NVIDIA adds new models?
MachCode automatically syncs with the NVIDIA Build API. If new models are released, MachCode discovers them automatically in the background. You can also trigger an instant sync anytime by typing:
```bash
mach> /model refresh
```

### 6. Can I use MachCode just to explore or ask questions?
Yes. Press `Tab` or type `/mode plan` to enter **Plan Mode**. In this mode, MachCode operates in read-only mode — it can read files and explain code, but will never make changes or run terminal commands.

---

## 📄 License

MachCode is free and open-source software distributed under the **[MIT License](LICENSE)**.
Contributions, bug reports, and suggestions are welcome! Check out [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.
