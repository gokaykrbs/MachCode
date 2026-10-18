/**
 * AutoRouter & Dynamic Model Categorization:
 * Organizes active NVIDIA NIM models into:
 * - StrongPool (parameters >= 30B, deep reasoning, heavyweight coding foundations)
 * - WeakPool (parameters < 30B, lightweight, fast instruction models for immediate fallback)
 */

export interface AutoRouteResult {
  lightModel: string;
  heavyModel: string;
}

export interface ModelPools {
  strongPool: string[];
  weakPool: string[];
}

export interface AutoRouterOptions {
  exclude?: Set<string> | string[];
  fallbackLight?: string;
  fallbackHeavy?: string;
  fallbackStrong?: string;
  fallbackWeak?: string;
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
 * Determines whether a model qualifies for the StrongPool:
 * - Parameter count >= 30B
 * - Deep reasoning / thinking models (e.g. contains 'reason', 'r1', 'o1')
 * - Ultra, super, or large foundation models
 */
export function isStrongModel(id: string): boolean {
  const lower = id.toLowerCase();
  if (
    lower.includes('reason') ||
    lower.includes('r1') ||
    lower.includes('deepseek-r1') ||
    lower.includes('o1') ||
    lower.includes('ultra') ||
    lower.includes('super')
  ) {
    return true;
  }

  const param = extractModelParamCount(lower);
  if (param !== null) {
    return param >= 30;
  }

  if (
    lower.includes('70b') ||
    lower.includes('120b') ||
    lower.includes('405b') ||
    lower.includes('34b') ||
    lower.includes('32b') ||
    lower.includes('large')
  ) {
    return true;
  }

  return false;
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
        score -= param;
      }
    } else if (lower.includes('7b') || lower.includes('8b')) {
      score += 50;
    }
  } else {
    // Look for larger parameter counts (e.g. 30b, 32b, 34b, 70b, 90b, 405b, large)
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
        score -= 50 - param;
      }
    } else if (lower.includes('70b') || lower.includes('405b') || lower.includes('32b')) {
      score += 70;
    }
  }

  return score;
}

/**
 * Categorizes available NVIDIA NIM models into a StrongPool and a WeakPool.
 * - StrongPool: parameters >= 30B or reasoning models
 * - WeakPool: parameters < 30B, fast/small models for fallback
 */
export function categorizeModels(
  availableModels: string[],
  options: AutoRouterOptions = {},
): ModelPools {
  const excludeSet = new Set(
    Array.isArray(options.exclude)
      ? options.exclude
      : options.exclude
        ? Array.from(options.exclude)
        : [],
  );

  const usable = availableModels.filter((id) => !excludeSet.has(id) && isUsableGenerativeModel(id));

  const fallbackStrong =
    options.fallbackStrong ??
    options.fallbackHeavy ??
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
  const fallbackWeak =
    options.fallbackWeak ??
    options.fallbackLight ??
    'meta/llama-3.2-11b-vision-instruct';

  const strongCandidates = usable.filter((id) => isStrongModel(id));
  const weakCandidates = usable.filter((id) => !isStrongModel(id));

  const strongPool = strongCandidates.sort(
    (a, b) => scoreModelRole(b, 'heavy') - scoreModelRole(a, 'heavy'),
  );
  const weakPool = weakCandidates.sort(
    (a, b) => scoreModelRole(b, 'light') - scoreModelRole(a, 'light'),
  );

  return {
    strongPool: strongPool.length > 0 ? strongPool : [fallbackStrong],
    weakPool: weakPool.length > 0 ? weakPool : [fallbackWeak],
  };
}

/**
 * Autonomously selects the top Lightweight (Fast/Weak) and Heavyweight (Smart/Strong) models
 * from a list of active NVIDIA NIM models.
 */
export function autoRouteModels(
  availableModels: string[],
  options: AutoRouterOptions = {},
): AutoRouteResult {
  const pools = categorizeModels(availableModels, options);
  return {
    lightModel: pools.weakPool[0] ?? options.fallbackLight ?? 'meta/llama-3.2-11b-vision-instruct',
    heavyModel: pools.strongPool[0] ?? options.fallbackHeavy ?? 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  };
}
