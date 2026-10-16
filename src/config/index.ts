import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';
import ora from 'ora';

export interface MachCodeConfig {
  nvidiaApiKey: string;
  createdAt: string;
  updatedAt: string;
}

const CONFIG_DIR_NAME = '.machcode';
const CONFIG_FILE_NAME = 'config.json';

/**
 * Returns the absolute path to the ~/.machcode directory.
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

/**
 * Returns the absolute path to ~/.machcode/config.json.
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

/**
 * Reads and parses the configuration file if it exists.
 * Returns null if the file does not exist or has no valid API key.
 */
export async function loadConfig(): Promise<MachCodeConfig | null> {
  const configPath = getConfigPath();
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MachCodeConfig>;
    if (typeof parsed.nvidiaApiKey === 'string' && parsed.nvidiaApiKey.trim().length > 0) {
      return {
        nvidiaApiKey: parsed.nvidiaApiKey.trim(),
        createdAt: parsed.createdAt ?? new Date().toISOString(),
        updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Saves the configuration securely to ~/.machcode/config.json with restricted permissions.
 */
export async function saveConfig(nvidiaApiKey: string): Promise<MachCodeConfig> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  const existing = await loadConfig();
  const now = new Date().toISOString();

  const config: MachCodeConfig = {
    nvidiaApiKey: nvidiaApiKey.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });

  return config;
}

/**
 * Prompts the user interactively for their NVIDIA_API_KEY.
 */
export async function promptForApiKey(): Promise<string> {
  console.log(
    chalk.cyan.bold('\nWelcome to MachCode!') +
      chalk.gray(' First-time configuration is required.\n'),
  );

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const answer = await rl.question(
        chalk.yellow('? ') + chalk.bold('Enter your NVIDIA_API_KEY: '),
      );
      const trimmed = answer.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
      console.log(chalk.red('Error: NVIDIA_API_KEY cannot be empty. Please try again.'));
    }
  } finally {
    rl.close();
  }
}

/**
 * Ensures a valid configuration exists in ~/.machcode/config.json.
 * Prompts the user on first run if no configuration file is found.
 */
export async function ensureConfig(): Promise<MachCodeConfig> {
  const existing = await loadConfig();
  if (existing) {
    return existing;
  }

  const apiKey = await promptForApiKey();
  const spinner = ora('Saving configuration securely to ~/.machcode/config.json...').start();

  try {
    const saved = await saveConfig(apiKey);
    spinner.succeed(chalk.green(`Configuration saved to ${getConfigPath()}`));
    return saved;
  } catch (error) {
    spinner.fail(chalk.red('Failed to save configuration.'));
    throw error;
  }
}
