import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { getActiveTheme, type ThemeColors } from './theme.js';
import { stripAnsi } from './terminalInput.js';

export interface StatusBarInfo {
  mode: 'build' | 'plan';
  baseDir: string;
  strongPoolCount?: number;
  activeModel?: string;
  isPinned?: boolean;
  gitBranch?: string;
  totalTokens?: number;
  autoApprove?: boolean;
  themeName?: string;
  sessionId?: string;
  subagentName?: string;
}

/**
 * Rapidly and safely resolves the current git branch name without hanging the REPL.
 * Checks `.git/HEAD` directly first (0ms), with fallback to `git rev-parse`.
 */
export function getGitBranch(workspaceDir: string): string | null {
  try {
    let currentDir = path.resolve(workspaceDir);
    const root = path.parse(currentDir).root;

    while (currentDir && currentDir !== root) {
      const gitPath = path.join(currentDir, '.git');
      if (fs.existsSync(gitPath)) {
        const stat = fs.statSync(gitPath);
        let headPath = path.join(gitPath, 'HEAD');

        if (stat.isFile()) {
          // git worktree pointer: "gitdir: /path/to/.git/worktrees/..."
          const gitfileContent = fs.readFileSync(gitPath, 'utf-8').trim();
          const match = /^gitdir:\s*(.+)$/m.exec(gitfileContent);
          if (match) {
            headPath = path.resolve(currentDir, match[1].trim(), 'HEAD');
          }
        }

        if (fs.existsSync(headPath)) {
          const headContent = fs.readFileSync(headPath, 'utf-8').trim();
          const refMatch = /^ref:\s*refs\/heads\/(.+)$/.exec(headContent);
          if (refMatch) {
            return refMatch[1].trim();
          }
          // Detached HEAD: return first 7 hex chars
          if (/^[0-9a-fA-F]{40}$/.test(headContent)) {
            return headContent.substring(0, 7);
          }
        }
        break;
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }

    // Secondary fallback to git binary with short timeout
    const branchOut = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: workspaceDir,
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    if (branchOut && branchOut !== 'HEAD') {
      return branchOut;
    }
  } catch {
    // Not a git repository or git unavailable
  }
  return null;
}

/**
 * Formats token count cleanly (e.g. 1420 -> "1.4k")
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}

/**
 * Renders an Antigravity / Claude Code style single-line responsive Status Bar.
 */
export function renderStatusBar(
  info: StatusBarInfo,
  options: { width?: number; theme?: ThemeColors } = {},
): string {
  const theme = options.theme ?? getActiveTheme();
  const width = options.width ?? (process.stdout.columns || 80);

  // 1. Mode Badge
  const modeText = info.mode === 'plan' ? 'PLAN' : 'BUILD';
  const modeBadge =
    info.mode === 'plan' ? theme.planMode(`[${modeText}]`) : theme.buildMode(`[${modeText}]`);

  // Subagent Badge (if active)
  const subagentBadge = info.subagentName ? theme.secondary(`🤖 @${info.subagentName}`) : null;

  // 2. Model / Racing Engine Badge
  let modelBadge = '';
  if (info.isPinned && info.activeModel) {
    const shortModel = info.activeModel.split('/').pop() ?? info.activeModel;
    modelBadge = theme.primary(`🎯 ${shortModel}`);
  } else if (info.strongPoolCount && info.strongPoolCount > 1) {
    modelBadge = theme.primary(`🏁 ${info.strongPoolCount} models`);
  } else if (info.activeModel) {
    const shortModel = info.activeModel.split('/').pop() ?? info.activeModel;
    modelBadge = theme.primary(`🤖 ${shortModel}`);
  } else {
    modelBadge = theme.primary('⚡ AutoRouter');
  }

  // 3. Workspace Directory
  const dirName = path.basename(path.resolve(info.baseDir)) || info.baseDir;
  const dirBadge = theme.muted(`📁 ${dirName}`);

  // 4. Git Branch
  const branch = info.gitBranch ?? getGitBranch(info.baseDir);
  const gitBadge = branch ? theme.secondary(`🌿 ${branch}`) : theme.muted('🌿 no-git');

  // 5. Token Statistics
  const tokenCount = info.totalTokens ?? 0;
  const tokensBadge = theme.muted(`🪙 ${formatTokenCount(tokenCount)} tokens`);

  // 6. Approval Policy
  const autoBadge = info.autoApprove ? theme.warning('⚡ auto') : theme.muted('🛡️ ask');

  // 7. Theme Indicator
  const themeBadge = theme.muted(`🎨 ${theme.name}`);

  // Assemble status segments
  const sep = theme.muted(' │ ');
  const rawSegments = [
    modeBadge,
    ...(subagentBadge ? [subagentBadge] : []),
    modelBadge,
    dirBadge,
    gitBadge,
    tokensBadge,
    autoBadge,
    themeBadge,
  ];

  // Gradually drop right-most segments if terminal width is constrained
  const currentSegments = [...rawSegments];
  let line = currentSegments.join(sep);

  while (stripAnsi(line).length > width - 2 && currentSegments.length > 2) {
    currentSegments.pop();
    line = currentSegments.join(sep);
  }

  return line;
}

/**
 * Prints a full diagnostic card for `/status`
 */
export function printStatusCard(info: StatusBarInfo): void {
  const theme = getActiveTheme();
  const branch = info.gitBranch ?? getGitBranch(info.baseDir);

  console.log(
    theme.primary('\n══════════════════════════════════════════════════════════════════'),
  );
  console.log(theme.primary('                     MACHCODE STATUS REPORT'));
  console.log(theme.primary('══════════════════════════════════════════════════════════════════'));

  console.log(
    `  ${chalk.bold('Active Mode:')}        ${
      info.mode === 'plan'
        ? theme.planMode('PLAN MODE (Read-only, file modifications & bash locked)')
        : theme.buildMode('BUILD MODE (Full Agent, file editing & shell execution enabled)')
    }`,
  );
  if (info.subagentName) {
    console.log(
      `  ${chalk.bold('Active Subagent:')}    ${theme.secondary(`🤖 @${info.subagentName}`)}`,
    );
  }
  console.log(`  ${chalk.bold('Workspace Path:')}     ${chalk.white(path.resolve(info.baseDir))}`);
  console.log(
    `  ${chalk.bold('Git Branch:')}         ${branch ? theme.secondary(`🌿 ${branch}`) : chalk.gray('None (Not a git repository)')}`,
  );
  console.log(
    `  ${chalk.bold('Racing Pool:')}        ${
      info.strongPoolCount
        ? theme.primary(
            `57+ Models racing in parallel (${info.strongPoolCount} active models in pool)`,
          )
        : chalk.gray('Autonomous dynamic model selection')
    }`,
  );
  if (info.activeModel) {
    console.log(`  ${chalk.bold('Current Focus Model:')} ${chalk.yellow(info.activeModel)}`);
  }
  console.log(
    `  ${chalk.bold('Approval Policy:')}    ${
      info.autoApprove
        ? chalk.yellow.bold('AUTO-APPROVE (Edits applied without confirmation)')
        : chalk.green.bold('ASK BEFORE WRITE (Diff preview + interactive prompt)')
    }`,
  );
  console.log(
    `  ${chalk.bold('Active Theme:')}       ${chalk.cyan.bold(theme.displayName)} ${chalk.gray(`(${theme.name})`)}`,
  );
  if (info.totalTokens !== undefined) {
    console.log(
      `  ${chalk.bold('Session Footprint:')}  ${chalk.white(formatTokenCount(info.totalTokens))} tokens`,
    );
  }
  if (info.sessionId) {
    console.log(`  ${chalk.bold('Session Identifier:')} ${chalk.dim(info.sessionId)}`);
  }
  console.log(
    theme.primary('══════════════════════════════════════════════════════════════════\n'),
  );
}
