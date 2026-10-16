# ⚡ MachCode

<p align="center">
  <strong>The Sniper AI Code Editor CLI</strong><br />
  <em>Zero-hallucination, blazing-fast code generation powered by Streaming Handoff Racing on NVIDIA NIM endpoints.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/machcode"><img src="https://img.shields.io/badge/npm-v0.1.0-blue.svg?style=flat-square" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="#"><img src="https://img.shields.io/badge/build-passing-brightgreen.svg?style=flat-square" alt="Build Status" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.6-blue.svg?style=flat-square&logo=typescript" alt="TypeScript" /></a>
  <a href="https://build.nvidia.com"><img src="https://img.shields.io/badge/NVIDIA%20NIM-Integrated-76B900.svg?style=flat-square&logo=nvidia" alt="NVIDIA NIM" /></a>
</p>

---

> *"Speed without hallucinations. Intelligence without the wait."*

**MachCode** is a terminal-native, hyper-disciplined AI code editor CLI. Built for developers who demand instant feedback and zero fluff, MachCode eliminates latency spikes and rate-limit wait times by racing multiple **NVIDIA Build (NIM)** LLM endpoints simultaneously using an innovative **Streaming Handoff** architecture.

---

## 💡 The Problem & The Solution

### 🛑 The Problem: The Latency vs. Quality Dilemma
- **Large Models (70B+ / Reasoning):** High code quality and deep reasoning, but suffer from cold starts, queue delays, and latency spikes.
- **Small Models (8B - 14B):** Instant Time-to-First-Token (TTFT), but prone to hallucinations, missing types, and conversational filler.
- **Result:** Developers are forced to choose between waiting 10+ seconds for code to start generating or fixing broken code from weaker models.

### ⚡ The Solution: Streaming Handoff Racing
MachCode launches concurrent streaming requests to both a **Lightweight (Fast)** model and a **Heavyweight (Deep)** model on NVIDIA NIM:

```
User Prompt
    │
    ├───► [Lightweight Model (e.g., Llama-3.3-70B)] ──► Emits 1st token (~300ms) ──► Streams to Terminal
    │                                                                                        │
    └───► [Heavyweight Model (e.g., Qwen-2.5-Coder)]                                        │
              │                                                                              │
              ▼                                                                              ▼
     Starts streaming within 3-second grace window? ──► YES ──► ABORT Lightweight Stream
              │                                                 CLEAR Terminal Output
              │                                                 SEAMLESSLY Stream Heavyweight from Token 0!
              ▼
             NO ──────────────────────────────────────────────► ABORT Heavyweight Request
                                                                Stick with Lightweight to Completion
```

1. **Immediate Feedback:** The Lightweight model outputs its first token almost instantaneously.
2. **The 3-Second Handoff Window:** If the Heavyweight model starts streaming within 3 seconds of the Lightweight model's first token, MachCode **immediately aborts** the Lightweight stream, wipes the terminal output using ANSI cursor controls, and seamlessly displays the Heavyweight model's response from the very beginning.
3. **Graceful Fallback:** If the Heavyweight model is queued or rate-limited, MachCode aborts it after 3 seconds and sticks with the Lightweight model without disrupting your workflow.

---

## 🎯 Key Features

- 🏎️ **Streaming Handoff Engine:** Eliminates rate-limit delays and latency spikes with concurrent multi-model streaming and deterministic `AbortController` handoffs.
- 🎯 **The "Sniper" System Prompt:** Synthesized from industry-standard coding agent instructions. Zero conversational filler, zero greetings, strict DRY code output.
- 🛑 **"Stop & Ask" Protocol:** If critical context or type signatures are missing, MachCode never guesses. It halts execution and prompts you directly with `QUESTION: [details]`.
- 🧠 **Hidden Chain-of-Thought (`<plan>`):** Models reason inside `<plan>...</plan>` XML blocks before writing code. MachCode hides this noise from your terminal and saves it cleanly to `~/.machcode/debug.log`.
- 🧩 **Built-in NVIDIA Verified Skills:** Automatically syncs and integrates official agent skills from [`NVIDIA/skills`](https://github.com/NVIDIA/skills) (cuDF, cuOpt, CUDA-Q, DOCA, DeepStream, Dynamo) plus local filesystem tools (`read_file`, `write_file`).
- 🛡️ **Safe File Execution & Green Summaries:** Automatically detects target files, blocks directory traversal outside the workspace, and prints a clear green summary of all modified files.

---

## 📦 Installation

### Prerequisites
- [Node.js](https://nodejs.org/) `>= 18.0.0`
- [pnpm](https://pnpm.io/) `>= 9.0.0` (recommended) or `npm`
- An [NVIDIA Build](https://build.nvidia.com) API key (`nvapi-...`)

### Global Installation

```bash
# Using pnpm
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

# 4. Link globally
pnpm link --global
```

---

## 🚀 Quick Start & Usage

### 1. Initialize Configuration
Run `mach hello` on first use. MachCode will prompt you for your `NVIDIA_API_KEY` and save it securely to `~/.machcode/config.json` with restricted permissions (`0o600`):

```bash
mach hello
```

*(You can also set the `NVIDIA_API_KEY` environment variable in your shell profile).*

### 2. Basic Code Editing
Simply provide your instruction. MachCode automatically scans your workspace, reads relevant files, and races the models:

```bash
mach "Make the login button blue and add email validation in src/components/Login.tsx"
```

### 3. Target Specific Files
You can explicitly specify a target file using `-f` or `--file`:

```bash
mach -f src/utils/auth.ts "Implement JWT token refresh rotation"
```

### 4. Custom Model Pairing & Handoff Window
Override the default fast and deep models or customize the handoff grace period:

```bash
mach "Optimize matrix multiplication kernel" \
  --light-model meta/llama-3.3-70b-instruct \
  --heavy-model deepseek-ai/deepseek-r1 \
  --window 4000
```

### 5. Inspect Built-in NVIDIA Skills
MachCode automatically ships with official NVIDIA Agent Skills:

```bash
mach skills
```

---

## ⚙️ CLI Options Reference

```text
Usage: mach [options] [command] [prompt...]

MachCode: Zero-hallucination, high-speed AI code editor CLI powered by
Streaming Handoff Racing on NVIDIA NIM.

Arguments:
  prompt                     Coding instruction (e.g. mach "update the login component")

Options:
  -V, --version              Output the version number
  -f, --file <path>          Target file path to read and overwrite
  -l, --light-model <model>  Lightweight fast NIM model (default: "meta/llama-3.3-70b-instruct")
  -m, --heavy-model <model>  Heavyweight deep coding NIM model (default: "qwen/qwen2.5-coder-32b-instruct")
  -w, --window <ms>          Streaming handoff window in milliseconds (default: "3000")
  -h, --help                 Display help for command

Commands:
  hello                      Verify MachCode installation and configuration
  skills                     List integrated official NVIDIA Agent Skills
```

---

## 🏗️ Architecture Map

```
machcode/
├── bin/
│   └── machcode.ts          # CLI binary & command router (commander)
├── src/
│   ├── config/              # Secure configuration manager (~/.machcode/config.json)
│   ├── engine/
│   │   ├── streamRacer.ts   # Core Streaming Handoff Engine with AbortControllers
│   │   └── executor.ts      # Safe file applier with green modification summary
│   ├── prompts/
│   │   └── sniper.ts        # Zero-chatter, anti-hallucination "Sniper" system prompt
│   ├── tools/
│   │   ├── index.ts         # Local filesystem tools (read_file, write_file) & schemas
│   │   └── nvidiaSkills.ts  # Automatic NVIDIA/skills fetcher, parser & cache
│   ├── utils/
│   │   └── streamParser.ts  # Stream state machine (hides <plan>, handles QUESTION:)
│   └── index.ts             # Main orchestrator & context gatherer
└── package.json
```

- **`src/engine/streamRacer.ts`**: Handles concurrent SSE connections to `/v1/chat/completions`. Manages active model switching, ANSI terminal buffer erasure, and instant stream abortion.
- **`src/prompts/sniper.ts`**: Enforces strict machine-parseable output: `<plan>...</plan>` followed only by Markdown code fences or `QUESTION: [details]`.
- **`src/utils/streamParser.ts`**: Token-level streaming parser. Intercepts partial tags across arbitrary chunk boundaries, appends hidden plans to `~/.machcode/debug.log`, and triggers the Stop & Ask protocol.
- **`src/tools/nvidiaSkills.ts`**: Built-in adapter for official `NVIDIA/skills` repository. Caches skills in `~/.machcode/skills/nvidia/` and formats them as OpenAI tools.
- **`src/engine/executor.ts`**: Strips Markdown wrappers, validates workspace boundaries, writes code to disk, and prints ANSI-styled diff summaries.

---

## 🧪 Testing

MachCode includes a comprehensive unit and mock SSE test suite powered by the Node.js test runner:

```bash
# Run tests
pnpm test

# Run linter and formatter checks
pnpm lint
pnpm format:check

# Compile TypeScript
pnpm build
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. **Fork** the repository.
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`).
3. **Commit** your changes adhering to conventional commits (`git commit -m 'feat: add amazing feature'`).
4. **Ensure** all tests pass (`pnpm test && pnpm lint`).
5. **Push** to your branch (`git push origin feature/amazing-feature`).
6. **Open** a Pull Request.

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.
