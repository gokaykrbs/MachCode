import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';

export interface MachCodeConfig {
  nvidiaApiKey: string;
  lightModel: string;
  heavyModel: string;
  strongPool?: string[];
  weakPool?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NvidiaModelInfo {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

export interface NvidiaModelsResponse {
  data?: NvidiaModelInfo[];
}

const CONFIG_DIR_NAME = '.machcode';
const CONFIG_FILE_NAME = 'config.json';
export const DEFAULT_NVIDIA_MODELS_ENDPOINT = 'https://integrate.api.nvidia.com/v1/models';
export const DEFAULT_API_TIMEOUT_MS = 10000;

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
  let parsed: Partial<MachCodeConfig> | null = null;

  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    parsed = JSON.parse(raw) as Partial<MachCodeConfig>;
  } catch {
    // Config file does not exist or is invalid JSON
  }

  const envKey =
    process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim().length > 0
      ? process.env.NVIDIA_API_KEY.trim()
      : undefined;

  const apiKey = envKey ?? parsed?.nvidiaApiKey;
  if (!apiKey || apiKey.trim().length === 0) {
    return null;
  }

  return {
    nvidiaApiKey: apiKey.trim(),
    lightModel: parsed?.lightModel ?? '',
    heavyModel: parsed?.heavyModel ?? '',
    strongPool: Array.isArray(parsed?.strongPool) ? parsed.strongPool : undefined,
    weakPool: Array.isArray(parsed?.weakPool) ? parsed.weakPool : undefined,
    createdAt: parsed?.createdAt ?? new Date().toISOString(),
    updatedAt: parsed?.updatedAt ?? new Date().toISOString(),
  };
}

/**
 * Saves the configuration securely to ~/.machcode/config.json with restricted permissions.
 */
export async function saveConfig(
  nvidiaApiKey: string,
  lightModel?: string,
  heavyModel?: string,
  strongPool?: string[],
  weakPool?: string[],
): Promise<MachCodeConfig> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  const existing = await loadConfig();
  const now = new Date().toISOString();

  const config: MachCodeConfig = {
    nvidiaApiKey: nvidiaApiKey.trim(),
    lightModel: (lightModel ?? existing?.lightModel ?? '').trim(),
    heavyModel: (heavyModel ?? existing?.heavyModel ?? '').trim(),
    strongPool: strongPool ?? existing?.strongPool,
    weakPool: weakPool ?? existing?.weakPool,
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
 * Dynamically fetches active models from the NVIDIA NIM models endpoint with a strict timeout.
 */
export async function fetchNvidiaModels(
  apiKey: string,
  baseUrl = 'https://integrate.api.nvidia.com/v1',
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
): Promise<string[]> {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new Error(`Network timeout: NVIDIA NIM model fetching exceeded ${timeoutMs}ms.`),
    );
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      const timeoutError = new Error(
        `Network timeout: NVIDIA NIM models API did not respond within ${timeoutMs / 1000}s.`,
      );
      (timeoutError as unknown as { isTimeout: boolean }).isTimeout = true;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let errorText = '';
    try {
      errorText = await response.text();
    } catch {
      // Ignore
    }
    throw new Error(
      `Failed to fetch NVIDIA NIM models (HTTP ${response.status}): ${errorText || response.statusText}`,
    );
  }

  const json = (await response.json()) as NvidiaModelsResponse;
  const list = Array.isArray(json.data)
    ? json.data
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];

  list.sort((a, b) => a.localeCompare(b));
  return list;
}

import {
  autoRouteModels,
  type AutoRouteResult,
  type AutoRouterOptions,
} from '../engine/autoRouter.js';

export interface EnsureConfigOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
}

/**
 * Autonomously fetches active models from NVIDIA NIM, executes AutoRouter categorization,
 * and saves the selected Lightweight and Heavyweight models to ~/.machcode/config.json silently.
 */
export async function autoAssignAndSaveModels(
  apiKey: string,
  baseUrl = 'https://integrate.api.nvidia.com/v1',
  fetchImpl: typeof fetch = globalThis.fetch,
  options: AutoRouterOptions = {},
): Promise<AutoRouteResult> {
  let availableModels: string[] = [];
  try {
    availableModels = await fetchNvidiaModels(apiKey, baseUrl, fetchImpl);
  } catch {
    // If fetching fails (e.g. offline, network glitch, or mock fetch in tests), autoRouteModels uses safe defaults
  }

  const { lightModel, heavyModel, strongPool, weakPool } = autoRouteModels(
    availableModels,
    options,
  );
  await saveConfig(apiKey, lightModel, heavyModel, strongPool, weakPool);
  return { lightModel, heavyModel, strongPool, weakPool };
}

/**
 * Ensures a valid configuration exists in ~/.machcode/config.json.
 * Prompts the user on first run if no API key is found, then autonomously
 * scans and assigns active models without prompting.
 */
export async function ensureConfig(options: EnsureConfigOptions = {}): Promise<MachCodeConfig> {
  let config = await loadConfig();
  let apiKey = options.apiKey ?? config?.nvidiaApiKey;

  if (!apiKey || apiKey.trim().length === 0) {
    apiKey = await promptForApiKey();
    config = await saveConfig(apiKey);
  }

  // If models or multi-model racing pools are not configured or a refresh was forced, auto-assign autonomously
  if (
    !config ||
    !config.lightModel ||
    !config.heavyModel ||
    !Array.isArray(config.strongPool) ||
    config.strongPool.length < 2 ||
    options.forceRefresh
  ) {
    const { lightModel, heavyModel, strongPool, weakPool } = await autoAssignAndSaveModels(
      apiKey,
      options.baseUrl,
      options.fetchImpl,
    );
    return {
      nvidiaApiKey: apiKey,
      lightModel,
      heavyModel,
      strongPool,
      weakPool,
      createdAt: config?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  return config;
}
