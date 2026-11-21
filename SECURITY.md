# Security Policy 🛡️

The MachCode team takes the security of our software and users seriously.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in MachCode, please do NOT file a public issue. Instead, report it privately through GitHub's Security Advisories tab or by contacting the maintainers directly.

Please include:
- A description of the vulnerability
- Steps to reproduce or a minimal proof of concept
- Potential impact
- Any suggested fixes or mitigations

We will acknowledge receipt within 48 hours and provide regular updates on remediation progress.

## Secret Hygiene & API Key Safety

- MachCode stores user NVIDIA API keys locally in `~/.machcode/config.json` with restricted filesystem permissions (`0600`).
- MachCode **never** transmits API keys, telemetry, or source code to third-party tracking services or analytics servers.
- Model requests communicate **only** with NVIDIA's official API endpoint (`https://integrate.api.nvidia.com/v1`).
- Shell command execution employs strict safety filters preventing accidental execution of destructive commands (`rm -rf`, `format`, `drop table`, `git push --force`) without explicit human confirmation.
