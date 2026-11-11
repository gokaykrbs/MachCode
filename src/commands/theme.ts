import chalk from 'chalk';
import { listThemes, saveThemePreference, getActiveTheme } from '../ui/theme.js';
import type { SlashCommand, CommandContext } from './types.js';

export const themeCommand: SlashCommand = {
  name: 'theme',
  description: 'View or switch the terminal color theme (e.g. /theme tokyo-night, dracula, matrix)',
  category: 'System',
  usage: '/theme [name]',
  aliases: ['themes'],
  execute: async (args: string, _context: CommandContext) => {
    const raw = args.trim().toLowerCase();

    if (!raw) {
      console.log(
        chalk.cyan.bold('\n══════════════════════════════════════════════════════════════════'),
      );
      console.log(chalk.cyan.bold('                 MACHCODE TERMINAL THEMES'));
      console.log(
        chalk.cyan.bold('══════════════════════════════════════════════════════════════════\n'),
      );

      const themes = listThemes();
      for (const t of themes) {
        const activeMarker = t.active ? chalk.green.bold('✔ ACTIVE ') : chalk.gray('         ');
        const themeNameCol = chalk.white.bold(t.name.padEnd(14));
        console.log(
          `  ${activeMarker} ${themeNameCol} ${chalk.gray('•')} ${chalk.yellow(t.displayName.padEnd(22))} ${chalk.dim(t.description)}`,
        );
      }

      console.log(
        chalk.dim(
          '\nTip: Type /theme <name> to switch immediately (e.g. /theme dracula or /theme matrix).\n',
        ),
      );
      return;
    }

    const success = await saveThemePreference(raw);
    if (success) {
      const newTheme = getActiveTheme();
      console.log(
        `\n${newTheme.success('✔ Theme switched successfully!')} Now using ${newTheme.primary(newTheme.displayName)} ${chalk.gray(`(${newTheme.name})`)}.\n`,
      );
    } else {
      console.log(
        chalk.red(`\n✖ Unknown theme "${args.trim()}". Type /theme to see available themes.\n`),
      );
    }
  },
};
