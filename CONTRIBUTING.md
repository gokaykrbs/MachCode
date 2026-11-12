# Contributing to MachCode 🚀

Thank you for your interest in contributing to **MachCode**! We welcome contributions from developers, researchers, and AI enthusiasts.

---

## Architectural Principles

Before contributing, please keep in mind MachCode's core architectural tenets:

1. **Strictly Bound to NVIDIA NIM**:
   MachCode uses NVIDIA Build API (`https://integrate.api.nvidia.com/v1`) exclusively. We do not support third-party proprietary LLM providers (e.g. OpenAI, Anthropic, Ollama). All LLM interactions must remain native to NVIDIA NIM endpoints.

2. **Parallel Streaming Racing Engine**:
   MachCode's signature capability is racing multiple models concurrently and handing off token generation dynamically. PRs should preserve and improve this latency advantage.

3. **Human-in-the-Loop Permissions**:
   Every file edit, patch, and terminal command must go through the interactive permission gate (`src/engine/permissions.ts`) with diff preview cards unless explicitly bypassed by the user.

---

## Development Setup

### Prerequisites

- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **pnpm**: v9.0.0 or higher
- **NVIDIA Build API Key**: Get a free API key from [NVIDIA Build](https://build.nvidia.com) (`nvapi-...`).

### Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/gokaykrbs/MachCode.git
cd MachCode

# 2. Install dependencies
pnpm install

# 3. Build TypeScript source
pnpm run build

# 4. Run tests
pnpm test

# 5. Check linting and formatting
pnpm run lint
pnpm run format:check
```

### CI / CD Workflows

Ready-to-use GitHub Actions workflows for multi-OS testing (Ubuntu, Windows, macOS across Node 18, 20, 22), automated NPM releases, and secret vulnerability scanning are maintained in `.ci-workflows/`. To enable them on your repository fork:
```bash
mkdir -p .github/workflows
cp .ci-workflows/* .github/workflows/
```

---

## Coding Standards & Workflow

- **TypeScript**: Strict mode enabled (`tsconfig.json`). No untyped `any` without justification.
- **Testing**: We use Node's native test runner (`node:test` + `node:assert`). Every new feature or bug fix must include corresponding tests.
- **Formatting**: Run `pnpm run format` before committing.
- **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat(...)`: A new feature
  - `fix(...)`: A bug fix
  - `docs(...)`: Documentation only changes
  - `style(...)`: Changes that do not affect the meaning of the code
  - `refactor(...)`: A code change that neither fixes a bug nor adds a feature
  - `perf(...)`: A code change that improves performance
  - `test(...)`: Adding missing tests or correcting existing tests
  - `chore(...)`: Changes to the build process or auxiliary tools

---

## Pull Request Process

1. Fork the repo and create your branch from `main`:
   ```bash
   git checkout -b feat/my-awesome-feature
   ```
2. Make your changes with focused, logical commits.
3. Verify that all checks pass:
   ```bash
   pnpm run format:check
   pnpm run lint
   pnpm run build
   pnpm test
   ```
4. Push your branch to GitHub and open a Pull Request against `main`.
5. Ensure your PR description follows the provided template.

---

## License

By contributing to MachCode, you agree that your contributions will be licensed under the MIT License.
