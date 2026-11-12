import type { SubagentDefinition, ParseSubagentResult } from './types.js';

export type { SubagentDefinition, ParseSubagentResult };

export const BUILTIN_SUBAGENTS: SubagentDefinition[] = [
  {
    id: 'architect',
    name: 'Architect',
    mention: '@architect',
    description:
      'Frontier system architect for high-level system design, schema, modularity, and RFC authoring',
    preferredModelPatterns: [
      'deepseek-r1',
      'llama-3.1-405b',
      'llama-3.3-70b',
      'nemotron-70b',
      'qwen-2.5-72b',
    ],
    defaultMode: 'plan',
    systemPrompt: `You are the ARCHITECT subagent in MachCode.
Your sole mission is high-level system design, software architecture, API contract modeling, and RFC planning.
Guidelines:
1. Emphasize modular boundaries, single responsibility, loose coupling, and maintainability.
2. Provide clean architectural diagrams (ASCII or Mermaid) and step-by-step implementation milestones.
3. Highlight trade-offs (latency vs throughput, memory vs compute, simplicity vs extensibility).
4. Do not write full implementation code unless explicitly requested; produce design specs, schemas, and file layout roadmaps.`,
  },
  {
    id: 'coder',
    name: 'Coder',
    mention: '@coder',
    description:
      'Ultra-fast surgical implementation specialist for clean diffs, feature implementation, and bug fixes',
    preferredModelPatterns: [
      'qwen2.5-coder',
      'deepseek-coder',
      'llama-3.3-70b',
      'llama-3.1-70b',
      'codellama',
    ],
    defaultMode: 'build',
    systemPrompt: `You are the CODER subagent in MachCode.
Your sole mission is surgical, production-grade code writing, bug fixing, and refactoring.
Guidelines:
1. Follow existing codebase conventions, formatting, and strict typing.
2. Keep edits minimal, precise, and targeted; avoid unnecessary churn or rewriting unrelated code.
3. Emit verified tool calls (edit_file, write_file, apply_diff) or clean fenced code blocks.
4. Zero chatter: no conversational preamble or postscript. Let code speak.`,
  },
  {
    id: 'tester',
    name: 'Tester',
    mention: '@tester',
    description:
      'Automated test suite engineer for rigorous unit tests, boundary fuzzing, and regression suites',
    preferredModelPatterns: [
      'qwen2.5-coder',
      'mixtral-8x22b',
      'llama-3.3-70b',
      'deepseek-coder',
      'llama-3.1-70b',
    ],
    defaultMode: 'build',
    systemPrompt: `You are the TESTER subagent in MachCode.
Your sole mission is designing and implementing robust test suites.
Guidelines:
1. Cover happy paths, negative paths, boundary conditions, edge cases, and error handling.
2. Use the project's native test framework (e.g. node:test, jest, vitest, pytest).
3. Write clean, deterministic, self-contained tests that run fast and never flake.
4. Verify assertions rigorously without tautological or meaningless tests.`,
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    mention: '@reviewer',
    description:
      'Strict quality gate and security auditor for vulnerability discovery, performance bottlenecks, and style conformity',
    preferredModelPatterns: [
      'deepseek-r1',
      'llama-3.1-405b',
      'nemotron-70b',
      'llama-3.3-70b',
      'qwen-2.5-72b',
    ],
    defaultMode: 'plan',
    systemPrompt: `You are the REVIEWER subagent in MachCode.
Your sole mission is comprehensive code quality review and security auditing.
Guidelines:
1. Inspect code for security vulnerabilities (injection, auth bypass, secret leaks, path traversal).
2. Check for memory leaks, resource leaks, unhandled promise rejections, and algorithmic bottlenecks.
3. Rate the code with clear severity categories: CRITICAL, WARNING, SUGGESTION.
4. For every issue flagged, provide an exact code fix or mitigation patch.`,
  },
  {
    id: 'nvidia',
    name: 'NVIDIA Specialist',
    mention: '@nvidia',
    description:
      'Expert in NVIDIA GPU acceleration, CUDA C++, TensorRT-LLM, cuDF, cuOpt, Triton, and DALI',
    preferredModelPatterns: [
      'deepseek-r1',
      'llama-3.1-405b',
      'nemotron-70b',
      'llama-3.3-70b',
      'meta/llama-3.1-70b-instruct',
    ],
    nvidiaSkillTags: [
      'cuda-q',
      'cudf',
      'cuopt',
      'dali',
      'deepstream',
      'doca',
      'dynamo',
      'tensorrt',
      'triton',
    ],
    defaultMode: 'build',
    systemPrompt: `You are the NVIDIA SPECIALIST subagent in MachCode.
Your sole mission is accelerating workloads using NVIDIA's official hardware and software stack.
Guidelines:
1. Specialize in CUDA C++, TensorRT, TensorRT-LLM, cuDF, cuOpt, Triton Inference Server, DALI, and DeepStream.
2. Maximize GPU compute efficiency, warp occupancy, shared memory utilization, and coalesced memory access.
3. Adhere strictly to official NVIDIA best practices and CUDA-X libraries.
4. Reference official NVIDIA Agent Skills when applicable.`,
  },
];

/**
 * Retrieves a subagent by ID or @mention trigger (e.g. 'architect' or '@architect').
 */
export function getSubagent(nameOrMention: string): SubagentDefinition | undefined {
  const clean = nameOrMention.trim().toLowerCase().replace(/^@/, '');
  return BUILTIN_SUBAGENTS.find((s) => s.id === clean || s.mention.toLowerCase() === `@${clean}`);
}

/**
 * Returns all registered subagents.
 */
export function getAllSubagents(): SubagentDefinition[] {
  return [...BUILTIN_SUBAGENTS];
}

/**
 * Detects if the prompt begins with a subagent mention (e.g. `@architect how should we...`),
 * and extracts the subagent and cleaned prompt.
 */
export function parseSubagentFromInput(prompt: string): ParseSubagentResult {
  const trimmed = prompt.trim();
  const mentionMatch = /^@([a-zA-Z0-9_-]+)(?:\s+(.*))?$/s.exec(trimmed);

  if (!mentionMatch) {
    return { cleanedPrompt: trimmed };
  }

  const candidateId = mentionMatch[1].toLowerCase();
  const subagent = getSubagent(candidateId);

  if (!subagent) {
    return { cleanedPrompt: trimmed };
  }

  return {
    subagent,
    cleanedPrompt: (mentionMatch[2] ?? '').trim(),
  };
}

/**
 * Selects the optimal model from the active NVIDIA NIM model pool based on
 * the subagent's preference rules. Falls back to default fallback model if no match.
 */
export function selectBestNvidiaModel(
  subagent: SubagentDefinition,
  availableModels: string[],
  fallbackModel: string,
): string {
  if (!availableModels || availableModels.length === 0) {
    return fallbackModel;
  }

  for (const pattern of subagent.preferredModelPatterns) {
    const pLower = pattern.toLowerCase();
    const match = availableModels.find((m) => m.toLowerCase().includes(pLower));
    if (match) {
      return match;
    }
  }

  return fallbackModel;
}
