import chalk from 'chalk';
import { loadConfig, saveConfig } from '../config/index.js';

export interface ThemeColors {
  name: string;
  displayName: string;
  description: string;
  primary: (text: string) => string;
  secondary: (text: string) => string;
  accent: (text: string) => string;
  success: (text: string) => string;
  warning: (text: string) => string;
  error: (text: string) => string;
  muted: (text: string) => string;
  planMode: (text: string) => string;
  buildMode: (text: string) => string;
  formatPrompt: (mode: 'build' | 'plan') => string;
}

export const THEMES: Record<string, ThemeColors> = {
  default: {
    name: 'default',
    displayName: 'MachCode Default',
    description: 'Crisp Antigravity cyan, yellow accents, and clean modern contrast',
    primary: (t) => chalk.cyan.bold(t),
    secondary: (t) => chalk.yellow(t),
    accent: (t) => chalk.cyan(t),
    success: (t) => chalk.green.bold(t),
    warning: (t) => chalk.yellow.bold(t),
    error: (t) => chalk.red.bold(t),
    muted: (t) => chalk.gray(t),
    planMode: (t) => chalk.magenta.bold(t),
    buildMode: (t) => chalk.green.bold(t),
    formatPrompt: (mode) =>
      mode === 'plan'
        ? `${chalk.cyan.bold('[machcode✨')} ${chalk.magenta.bold('(plan)')}${chalk.cyan.bold(']')} ${chalk.yellow('>')} `
        : `${chalk.cyan.bold('[machcode✨]')} ${chalk.yellow('>')} `,
  },
  'tokyo-night': {
    name: 'tokyo-night',
    displayName: 'Tokyo Night',
    description: 'Deep indigo, vibrant purple, cyan neon, and soft pastels',
    primary: (t) => chalk.hex('#7aa2f7').bold(t),
    secondary: (t) => chalk.hex('#bb9af7')(t),
    accent: (t) => chalk.hex('#7dcfff')(t),
    success: (t) => chalk.hex('#9ece6a').bold(t),
    warning: (t) => chalk.hex('#e0af68').bold(t),
    error: (t) => chalk.hex('#f7768e').bold(t),
    muted: (t) => chalk.hex('#565f89')(t),
    planMode: (t) => chalk.hex('#bb9af7').bold(t),
    buildMode: (t) => chalk.hex('#9ece6a').bold(t),
    formatPrompt: (mode) =>
      mode === 'plan'
        ? `${chalk.hex('#7aa2f7').bold('[machcode✨')} ${chalk.hex('#bb9af7').bold('(plan)')}${chalk.hex('#7aa2f7').bold(']')} ${chalk.hex('#7dcfff')('❯')} `
        : `${chalk.hex('#7aa2f7').bold('[machcode✨]')} ${chalk.hex('#7dcfff')('❯')} `,
  },
  dracula: {
    name: 'dracula',
    displayName: 'Dracula',
    description: 'Vampire purple, radiant pink, lime green, and gothic contrast',
    primary: (t) => chalk.hex('#bd93f9').bold(t),
    secondary: (t) => chalk.hex('#ff79c6')(t),
    accent: (t) => chalk.hex('#8be9fd')(t),
    success: (t) => chalk.hex('#50fa7b').bold(t),
    warning: (t) => chalk.hex('#f1fa8c').bold(t),
    error: (t) => chalk.hex('#ff5555').bold(t),
    muted: (t) => chalk.hex('#6272a4')(t),
    planMode: (t) => chalk.hex('#ff79c6').bold(t),
    buildMode: (t) => chalk.hex('#50fa7b').bold(t),
    formatPrompt: (mode) =>
      mode === 'plan'
        ? `${chalk.hex('#bd93f9').bold('[machcode🧛')} ${chalk.hex('#ff79c6').bold('(plan)')}${chalk.hex('#bd93f9').bold(']')} ${chalk.hex('#ff79c6')('❯')} `
        : `${chalk.hex('#bd93f9').bold('[machcode🧛]')} ${chalk.hex('#50fa7b')('❯')} `,
  },
  matrix: {
    name: 'matrix',
    displayName: 'The Matrix',
    description: 'Phosphor green terminal, operator glyphs, and deep cyber aesthetic',
    primary: (t) => chalk.hex('#00ff66').bold(t),
    secondary: (t) => chalk.hex('#20c20e')(t),
    accent: (t) => chalk.hex('#00ff41')(t),
    success: (t) => chalk.hex('#00ff66').bold(t),
    warning: (t) => chalk.hex('#39ff14').bold(t),
    error: (t) => chalk.hex('#ff0033').bold(t),
    muted: (t) => chalk.hex('#005c1e')(t),
    planMode: (t) => chalk.hex('#39ff14').bold(t),
    buildMode: (t) => chalk.hex('#00ff66').bold(t),
    formatPrompt: (mode) =>
      mode === 'plan'
        ? `${chalk.hex('#00ff66').bold('[machcode⚡')} ${chalk.hex('#39ff14').bold('(plan)')}${chalk.hex('#00ff66').bold(']')} ${chalk.hex('#00ff41')('❯')} `
        : `${chalk.hex('#00ff66').bold('[machcode⚡]')} ${chalk.hex('#00ff41')('❯')} `,
  },
  monokai: {
    name: 'monokai',
    displayName: 'Monokai Pro',
    description: 'Iconic editor palette: warm yellow, lively pink, vivid mint, warm stone',
    primary: (t) => chalk.hex('#e6db74').bold(t),
    secondary: (t) => chalk.hex('#f92672')(t),
    accent: (t) => chalk.hex('#66d9ef')(t),
    success: (t) => chalk.hex('#a6e22e').bold(t),
    warning: (t) => chalk.hex('#fd971f').bold(t),
    error: (t) => chalk.hex('#f92672').bold(t),
    muted: (t) => chalk.hex('#75715e')(t),
    planMode: (t) => chalk.hex('#ae81ff').bold(t),
    buildMode: (t) => chalk.hex('#a6e22e').bold(t),
    formatPrompt: (mode) =>
      mode === 'plan'
        ? `${chalk.hex('#e6db74').bold('[machcode💎')} ${chalk.hex('#ae81ff').bold('(plan)')}${chalk.hex('#e6db74').bold(']')} ${chalk.hex('#f92672')('❯')} `
        : `${chalk.hex('#e6db74').bold('[machcode💎]')} ${chalk.hex('#a6e22e')('❯')} `,
  },
  cyberpunk: {
    name: 'cyberpunk',
    displayName: 'Cyberpunk 2077',
    description: 'Electric yellow, hyper-saturated cyan, hot pink and high-frequency glow',
    primary: (t) => chalk.hex('#fcee0a').bold(t),
    secondary: (t) => chalk.hex('#00f0ff')(t),
    accent: (t) => chalk.hex('#ff003c')(t),
    success: (t) => chalk.hex('#00ff9f').bold(t),
    warning: (t) => chalk.hex('#fcee0a').bold(t),
    error: (t) => chalk.hex('#ff003c').bold(t),
    muted: (t) => chalk.hex('#71717a')(t),
    planMode: (t) => chalk.hex('#ff003c').bold(t),
    buildMode: (t) => chalk.hex('#00f0ff').bold(t),
    formatPrompt: (mode) =>
      mode === 'plan'
        ? `${chalk.hex('#fcee0a').bold('[machcode⚡')} ${chalk.hex('#ff003c').bold('(plan)')}${chalk.hex('#fcee0a').bold(']')} ${chalk.hex('#00f0ff')('❯')} `
        : `${chalk.hex('#fcee0a').bold('[machcode⚡]')} ${chalk.hex('#00f0ff')('❯')} `,
  },
  minimal: {
    name: 'minimal',
    displayName: 'Minimalist Monochrome',
    description: 'Subtle titanium whites, soft slate tints, and distraction-free quiet focus',
    primary: (t) => chalk.white.bold(t),
    secondary: (t) => chalk.gray(t),
    accent: (t) => chalk.white(t),
    success: (t) => chalk.white.bold(t),
    warning: (t) => chalk.dim(t),
    error: (t) => chalk.red(t),
    muted: (t) => chalk.dim(t),
    planMode: (t) => chalk.white.italic(t),
    buildMode: (t) => chalk.white.bold(t),
    formatPrompt: (mode) =>
      mode === 'plan'
        ? `${chalk.white.bold('[machcode')} ${chalk.dim('(plan)')}${chalk.white.bold(']')} > `
        : `${chalk.white.bold('[machcode]')} > `,
  },
};

let currentThemeKey = 'default';

export function getActiveTheme(): ThemeColors {
  return THEMES[currentThemeKey] ?? THEMES.default;
}

export function setActiveTheme(name: string): boolean {
  const normalized = name.toLowerCase().trim();
  if (THEMES[normalized]) {
    currentThemeKey = normalized;
    return true;
  }
  return false;
}

export function listThemes(): Array<{ name: string; displayName: string; description: string; active: boolean }> {
  return Object.values(THEMES).map((theme) => ({
    name: theme.name,
    displayName: theme.displayName,
    description: theme.description,
    active: theme.name === currentThemeKey,
  }));
}

export async function saveThemePreference(themeName: string): Promise<boolean> {
  if (!setActiveTheme(themeName)) {
    return false;
  }
  try {
    const existing = await loadConfig();
    if (existing) {
      await saveConfig(
        existing.nvidiaApiKey,
        existing.lightModel,
        existing.heavyModel,
        existing.strongPool,
        existing.weakPool,
        themeName,
      );
    }
    return true;
  } catch {
    return false;
  }
}

export async function loadSavedTheme(): Promise<string> {
  try {
    const existing = await loadConfig();
    const saved = existing?.theme;
    if (saved && THEMES[saved]) {
      currentThemeKey = saved;
      return saved;
    }
  } catch {
    // ignore
  }
  return 'default';
}
