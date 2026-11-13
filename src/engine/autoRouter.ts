/**
 * AutoRouter & Dynamic Model Categorization:
 * Organizes active NVIDIA NIM models into:
 * - StrongPool (parameters >= 30B, deep reasoning, heavyweight coding foundations)
 * - WeakPool (parameters < 30B, lightweight, fast instruction models for immediate fallback)
 */

export interface AutoRouteResult {
  lightModel: string;
  heavyModel: string;
  strongPool?: string[];
  weakPool?: string[];
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
  maxPoolSize?: number;
}

/**
 * Verified active multi-provider frontier models on NVIDIA NIM.
 * Prioritizes diverse model families (MiniMax, OpenAI OSS, Google Gemma, Meta Muse, DeepSeek, NVIDIA)
 * so multi-model racing genuinely competes across distinct AI providers.
 */
export const VERIFIED_STRONG_POOL_MODELS: readonly string[] = [
  'moonshotai/kimi-k3.1',
  'moonshotai/kimi-k2.6',
  'deepseek-ai/deepseek-r1',
  'deepseek-ai/deepseek-coder-6.7b-instruct',
  'qwen/qwen2.5-coder-32b-instruct',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'meta/llama-3.1-405b-instruct',
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
  'meta/codellama-70b',
  'mistralai/mistral-large-2-instruct',
];

export const VERIFIED_WEAK_POOL_MODELS: readonly string[] = [
  'poolside/laguna-xs-2.1',
  'minimaxai/minimax-m3.1-flash',
  'openai/gpt-oss-20b',
  'google/diffusiongemma-26b-a4b-it',
  'nvidia/nemotron-3.5-bolt-e4b',
  'meta/llama-3.2-11b-vision-instruct',
];

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
  'deplot',
  'kosmos',
  'fuyu',
  'vila',
  'neva',
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
 * - Deep reasoning / thinking models (e.g. Kimi, DeepSeek R1/V3/33B, Qwen Coder, R1, O1)
 * - Parameter count >= 30B
 * - Ultra, super, or large foundation models
 */
export function isStrongModel(id: string): boolean {
  const lower = id.toLowerCase();
  const param = extractModelParamCount(lower);

  // Explicitly small parameter counts (< 15B) are lightweight models (e.g. 6.7b, 7b, 8b)
  if (param !== null && param < 15) {
    return false;
  }

  // Micro and lightweight fast models belong in WeakPool, not StrongPool
  if (
    lower.includes('xs-') ||
    lower.includes('laguna') ||
    lower.includes('nano-fast') ||
    lower.includes('bolt-e4b')
  ) {
    return false;
  }

  if (
    lower.includes('kimi') ||
    lower.includes('moonshot') ||
    lower.includes('deepseek-r1') ||
    lower.includes('deepseek-v3') ||
    lower.includes('deepseek-coder-33b') ||
    lower.includes('deepseek') ||
    lower.includes('reason') ||
    lower.includes('r1') ||
    lower.includes('o1') ||
    lower.includes('ultra') ||
    lower.includes('super')
  ) {
    return true;
  }

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
 * Determines whether a model is an elite frontier reasoning / heavy coding model
 * (DeepSeek R1/V3/33B, Kimi/Moonshot, Qwen Coder, 70B+ reasoning foundations).
 */
export function isEliteHeavyModel(id: string): boolean {
  const lower = id.toLowerCase();
  const param = extractModelParamCount(lower);
  if (param !== null && param < 15) {
    return false;
  }
  if (
    lower.includes('flash') ||
    lower.includes('bolt-e4b') ||
    lower.includes('nano-fast') ||
    lower.includes('xs') ||
    lower.includes('laguna') ||
    lower.includes('guard')
  ) {
    return false;
  }
  return (
    lower.includes('kimi') ||
    lower.includes('moonshot') ||
    lower.includes('deepseek') ||
    lower.includes('reason') ||
    lower.includes('r1') ||
    lower.includes('qwen2.5-coder') ||
    lower.includes('codellama-70b') ||
    lower.includes('nemotron-3-nano-omni') ||
    lower.includes('nemotron-3.5-super') ||
    lower.includes('405b') ||
    lower.includes('340b') ||
    (lower.includes('70b') && (lower.includes('coder') || lower.includes('instruct')))
  );
}

/**
 * Analyzes instruction prompt, subagent context, and mode to determine
 * whether a task is heavy/complex requiring deep reasoning and frontier coding capability.
 */
export function isHeavyTask(
  prompt: string,
  options?: { mode?: string; subagent?: string; isExplicitHeavy?: boolean },
): boolean {
  if (options?.isExplicitHeavy) return true;
  if (
    options?.subagent &&
    ['architect', 'coder', 'reviewer'].includes(options.subagent.toLowerCase())
  ) {
    return true;
  }
  if (options?.mode === 'plan') return true;

  const lower = prompt.toLowerCase();

  // Explicit model requests in prompt
  if (
    lower.includes('deepseek') ||
    lower.includes('kimi') ||
    lower.includes('moonshot') ||
    lower.includes('r1')
  ) {
    return true;
  }

  // Heavy task keywords (Turkish and English)
  const heavyKeywords = [
    // Turkish keywords
    'ağır',
    'agir',
    'karmaşık',
    'karmasik',
    'zor',
    'mimari',
    'refactor',
    'yeniden yapılandır',
    'yeniden yapilandir',
    'sıfırdan',
    'sifirdan',
    'algoritma',
    'derin',
    'güvenlik',
    'guvenlik',
    'optimizasyon',
    'baştan yaz',
    'bastan yaz',
    'analiz et',
    'tasarla',
    'çözümle',
    'cozumle',
    'hata ayıkla',
    'hata ayikla',
    'kapsamlı',
    'kapsamli',
    'ölçeklenebilir',
    'olceklenebilir',
    // English keywords
    'heavy',
    'complex',
    'architecture',
    'refactor',
    'rewrite',
    'optimize',
    'optimization',
    'security',
    'vulnerability',
    'algorithm',
    'implement from scratch',
    'comprehensive',
    'debug',
    'concurrency',
    'race condition',
    'deadlock',
    'scalability',
    'distributed',
    'benchmark',
  ];

  if (heavyKeywords.some((kw) => lower.includes(kw))) {
    return true;
  }

  // Complex prompt structure: large token/word count or multiline code
  const words = prompt.trim().split(/\s+/).length;
  if (words >= 60 || prompt.length >= 400 || (prompt.includes('```') && prompt.length >= 200)) {
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
  if (lower.includes('kimi') || lower.includes('moonshot')) {
    score += role === 'heavy' ? 180 : 10;
  }
  if (lower.includes('deepseek')) {
    score += role === 'heavy' ? 80 : 20;
  }
  if (lower.includes('qwen')) {
    score += role === 'heavy' ? 50 : 15;
  }
  if (lower.includes('reason') || lower.includes('r1') || lower.includes('o1')) {
    score += role === 'heavy' ? 90 : -30;
  }
  if (
    lower.includes('llama') ||
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
    // Heavy role: penalize flash/mini/nano models so they don't hijack heavyModel!
    if (
      lower.includes('flash') ||
      lower.includes('mini') ||
      lower.includes('nano-fast') ||
      lower.includes('bolt-e4b')
    ) {
      score -= 60;
    }
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
 * - StrongPool: multi-provider frontier reasoning & coding models raced in parallel
 * - WeakPool: fast instruction models for immediate fallback
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
  const usableSet = new Set(usable);
  const maxPoolSize = options.maxPoolSize;

  const fallbackStrong =
    options.fallbackStrong ??
    options.fallbackHeavy ??
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
  const fallbackWeak =
    options.fallbackWeak ?? options.fallbackLight ?? 'meta/llama-3.2-11b-vision-instruct';

  // Check if live multi-provider NIM catalog models are present in `usable`
  const verifiedStrongPresent = VERIFIED_STRONG_POOL_MODELS.filter((m) => usableSet.has(m));
  const verifiedWeakPresent = VERIFIED_WEAK_POOL_MODELS.filter((m) => usableSet.has(m));

  const strongCandidates = usable.filter((id) => isStrongModel(id));
  const weakCandidates = usable.filter((id) => !isStrongModel(id));

  const sortedStrong = strongCandidates.sort(
    (a, b) => scoreModelRole(b, 'heavy') - scoreModelRole(a, 'heavy'),
  );
  const sortedWeak = weakCandidates.sort(
    (a, b) => scoreModelRole(b, 'light') - scoreModelRole(a, 'light'),
  );

  // Put sorted heavy models FIRST so frontier reasoning models lead the race!
  const allUsableOrdered = Array.from(
    new Set([
      ...sortedStrong,
      ...verifiedStrongPresent,
      ...sortedWeak.filter((m) => !m.includes('bolt-e4b')),
      ...sortedWeak.filter((m) => m.includes('bolt-e4b')),
    ]),
  );

  const rawStrongPool =
    sortedStrong.length > 0
      ? allUsableOrdered
      : verifiedStrongPresent.length > 0
        ? verifiedStrongPresent
        : VERIFIED_STRONG_POOL_MODELS.filter((m) => !excludeSet.has(m));

  const rawWeakPool =
    verifiedWeakPresent.length >= 2
      ? Array.from(new Set([...verifiedWeakPresent, ...sortedWeak]))
      : sortedWeak.length > 0
        ? sortedWeak
        : VERIFIED_WEAK_POOL_MODELS.filter((m) => !excludeSet.has(m));

  const strongPool = maxPoolSize ? rawStrongPool.slice(0, maxPoolSize) : rawStrongPool;
  const weakPool = maxPoolSize ? rawWeakPool.slice(0, maxPoolSize) : rawWeakPool;

  return {
    strongPool: strongPool.length > 0 ? strongPool : [fallbackStrong],
    weakPool: weakPool.length > 0 ? weakPool : [fallbackWeak],
  };
}

/**
 * Autonomously selects the top Lightweight (Fast/Weak) and Heavyweight (Smart/Strong) models
 * as well as the full multi-model racing pools from a list of active NVIDIA NIM models.
 */
export function autoRouteModels(
  availableModels: string[],
  options: AutoRouterOptions = {},
): AutoRouteResult {
  const pools = categorizeModels(availableModels, options);
  return {
    lightModel: pools.weakPool[0] ?? options.fallbackLight ?? 'meta/llama-3.2-11b-vision-instruct',
    heavyModel:
      pools.strongPool[0] ??
      options.fallbackHeavy ??
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    strongPool: pools.strongPool,
    weakPool: pools.weakPool,
  };
}
