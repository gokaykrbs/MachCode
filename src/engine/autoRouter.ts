/**
 * AutoRouter utility: autonomously categorizes and assigns active NIM models
 * into Lightweight (Fast) and Heavyweight (Smart) based on parameter counts,
 * coding capabilities, and instruction tuning.
 */

export interface AutoRouteResult {
  lightModel: string;
  heavyModel: string;
}

export interface AutoRouterOptions {
  exclude?: Set<string> | string[];
  fallbackLight?: string;
  fallbackHeavy?: string;
}

const UNWANTED_SUBSTRINGS = [
  'embed',
  'retriever',
  'guard',
  'safety',
  'reward',
  'detector',
  'parse',
  'clip',
  'translate',
  'calibration',
  'synthetic',
];

/**
 * Filters out embedding, guardrail, safety, clip, and utility models.
 */
export function isUsableGenerativeModel(id: string): boolean {
  const lower = id.toLowerCase();
  return !UNWANTED_SUBSTRINGS.some((sub) => lower.includes(sub));
}

/**
 * Extracts integer parameter count in billions from model string (e.g., "7b", "70b").
 */
export function extractModelParamCount(id: string): number | null {
  const match = id.toLowerCase().match(/(\d+)b\b/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Scores a model for suitability as either a Lightweight (Fast) or Heavyweight (Smart) model.
 */
export function scoreModelRole(id: string, role: 'light' | 'heavy'): number {
  const lower = id.toLowerCase();
  let score = 0;
  const param = extractModelParamCount(lower);

  // Coding specialization bonus
  if (
    lower.includes('coder') ||
    lower.includes('codestral') ||
    lower.includes('codellama') ||
    lower.includes('code')
  ) {
    score += 50;
  }
  // Instruction/Chat tuning bonus
  if (lower.includes('instruct') || lower.includes('-it') || lower.includes('chat')) {
    score += 30;
  }
  // Renowned foundation model families for coding/reasoning
  if (
    lower.includes('llama') ||
    lower.includes('deepseek') ||
    lower.includes('mistral') ||
    lower.includes('granite') ||
    lower.includes('gemma')
  ) {
    score += 20;
  }

  if (role === 'light') {
    // Look for smaller parameter counts (e.g. 7b, 8b, mini, flash, etc.)
    if (
      lower.includes('flash') ||
      lower.includes('mini') ||
      lower.includes('small') ||
      lower.includes('nano')
    ) {
      score += 40;
    }
    if (param !== null) {
      if (param >= 6 && param <= 14) {
        score += 60;
      } else if (param < 6) {
        score += 30;
      } else {
        score -= param; // Penalize large parameter models for fast streaming handoff racing
      }
    } else if (lower.includes('7b') || lower.includes('8b')) {
      score += 50;
    }
  } else {
    // Look for larger parameter counts (e.g. 32b, 34b, 70b, 90b, 405b, large)
    if (lower.includes('large') || lower.includes('ultra') || lower.includes('super')) {
      score += 30;
    }
    if (param !== null) {
      if (param >= 65 && param <= 100) {
        score += 80;
      } else if (param >= 20 && param < 65) {
        score += 65;
      } else if (param > 100) {
        score += 45;
      } else {
        score -= 50 - param; // Penalize small parameter models for deep heavyweight tasks
      }
    } else if (lower.includes('70b') || lower.includes('405b') || lower.includes('32b')) {
      score += 70;
    }
  }

  return score;
}

/**
 * Autonomously selects the best Lightweight (Fast) and Heavyweight (Smart) models
 * from a list of active NVIDIA NIM models.
 */
export function autoRouteModels(
  availableModels: string[],
  options: AutoRouterOptions = {},
): AutoRouteResult {
  const excludeSet = new Set(
    Array.isArray(options.exclude)
      ? options.exclude
      : options.exclude
        ? Array.from(options.exclude)
        : [],
  );

  const usable = availableModels.filter((id) => !excludeSet.has(id) && isUsableGenerativeModel(id));

  const fallbackLight = options.fallbackLight ?? 'meta/llama-3.1-8b-instruct';
  const fallbackHeavy = options.fallbackHeavy ?? 'meta/llama-3.1-70b-instruct';

  if (usable.length === 0) {
    return {
      lightModel: fallbackLight,
      heavyModel: fallbackHeavy,
    };
  }

  const lightRanked = [...usable].sort(
    (a, b) => scoreModelRole(b, 'light') - scoreModelRole(a, 'light'),
  );
  const heavyRanked = [...usable].sort(
    (a, b) => scoreModelRole(b, 'heavy') - scoreModelRole(a, 'heavy'),
  );

  const lightModel = lightRanked[0];
  const heavyModel = heavyRanked.find((m) => m !== lightModel) ?? heavyRanked[0] ?? fallbackHeavy;

  return {
    lightModel: lightModel ?? fallbackLight,
    heavyModel: heavyModel ?? fallbackHeavy,
  };
}
