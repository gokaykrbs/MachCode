# Changelog

All notable changes to **MachCode** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Aligned GitHub Actions workflows (`ci.yml`, `security.yml`, `release.yml`) with `packageManager: pnpm@12.21.0` so `pnpm-workspace.yaml` is parsed cleanly across Ubuntu, Windows, and macOS runners.
- Enforced LF line endings via `.gitattributes` and `.editorconfig` for cross-platform Prettier and CLI shebang consistency.

### Added
- Dependabot configuration (`.github/dependabot.yml`) for weekly npm and GitHub Actions updates.
- Least-privilege `permissions: contents: read` and concurrency guards for CI workflows.
- `CHANGELOG.md` and refreshed live CI/Security badges in English and Turkish documentation.

## [0.1.0] - 2026-11-21

### Added
- **Parallel Multi-Model Streaming Handoff Racing** powered exclusively by NVIDIA Build (NIM).
- **Dynamic NVIDIA NIM Model Catalog Sync** with `/model refresh` and latency/TPS benchmarking via `/race`.
- **Dual Operating Modes** (`[PLAN]` read-only vs `[BUILD]` active agent) with `Tab` toggle and `/mode`.
- **Human-in-the-Loop Safety & Diffs** with interactive diff previews, `/approve [ask|auto]`, file snapshots (`/snapshots`), and instant rollbacks (`/undo`).
- **5 Built-in Specialized Subagents**: `@architect`, `@coder`, `@tester`, `@reviewer`, and `@nvidia`.
- **Official NVIDIA Agent Skills Integration** (`/skill` and `mach skills`).
- **Model Context Protocol (MCP) Bridge** for workspace-configured tools (`.machcode/mcp.json`).
- **Workspace Tools**: Fast regex search (`/search`), unified diff & fuzzy patch applier, `@file` mention expansion, Git helpers (`/diff`, `/commit`, `/branch`), session persistence (`/save`, `/sessions`, `/resume`), context summarization, and terminal themes (`/theme`).
- **Open-Source Community Foundations**: MIT License, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub Issue/PR templates, and bilingual documentation (`README.md` & `README.tr.md`).

[Unreleased]: https://github.com/gokaykrbs/MachCode/compare/main...HEAD
[0.1.0]: https://github.com/gokaykrbs/MachCode/commits/main
