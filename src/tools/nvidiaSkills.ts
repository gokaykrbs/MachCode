import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from '../config/index.js';

export interface NvidiaSkillMetadata {
  name: string;
  product: string;
  description: string;
  version?: string;
  tags?: string[];
  repoPath: string;
}

export interface LoadedNvidiaSkill extends NvidiaSkillMetadata {
  content: string;
  source: 'cache' | 'remote' | 'builtin';
}

export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    strict?: boolean;
    parameters: {
      type: 'object';
      properties: Record<
        string,
        {
          type: string;
          description: string;
          enum?: string[];
        }
      >;
      required: string[];
      additionalProperties: boolean;
    };
  };
}

export const NVIDIA_SKILLS_RAW_BASE_URL = 'https://raw.githubusercontent.com/NVIDIA/skills/main';

/**
 * Official verified catalog of NVIDIA Agent Skills from https://github.com/NVIDIA/skills.
 * Used as the default index and offline fallback when syncing skills automatically.
 */
export const OFFICIAL_NVIDIA_SKILLS_CATALOG: NvidiaSkillMetadata[] = [
  {
    name: 'accelerated-computing-cudf',
    product: 'cuDF',
    description:
      'Official NVIDIA-authored guidance for NVIDIA cuDF GPU DataFrames, pandas acceleration, dask-cuDF, ETL, joins, groupby, CSV/Parquet I/O, nullable semantics, and multi-GPU DataFrame workloads.',
    repoPath: 'skills/accelerated-computing-cudf/SKILL.md',
    tags: ['cudf', 'gpu', 'dataframe', 'pandas', 'cuda-x'],
  },
  {
    name: 'cuopt-numerical-optimization-api',
    product: 'cuOpt',
    description:
      'LP, MILP, and QP (beta) with cuOpt — Python, C, and CLI. Use when the user is solving LP, MILP, or QP with any cuOpt interface.',
    repoPath: 'skills/cuopt-numerical-optimization-api/SKILL.md',
    tags: ['cuopt', 'linear-programming', 'milp', 'qp', 'optimization'],
  },
  {
    name: 'cuopt-routing-api-python',
    product: 'cuOpt',
    description:
      'GPU-accelerated vehicle routing problem (VRP, CVRP, VRPTW, PDP) optimization using the NVIDIA cuOpt Python API.',
    repoPath: 'skills/cuopt-routing-api-python/SKILL.md',
    tags: ['cuopt', 'routing', 'vrp', 'python'],
  },
  {
    name: 'cudaq-guide',
    product: 'CUDA-Q',
    description:
      'Use for CUDA-Q setup, simulation targets, QPU access, and @cudaq.kernel quantum-classical authoring guidance.',
    repoPath: 'skills/cudaq-guide/SKILL.md',
    tags: ['cuda-q', 'quantum', 'kernel', 'simulation'],
  },
  {
    name: 'dali-dynamic-mode',
    product: 'DALI',
    description:
      'GPU-accelerated data loading and preprocessing pipelines with NVIDIA DALI dynamic mode.',
    repoPath: 'skills/dali-dynamic-mode/SKILL.md',
    tags: ['dali', 'data-loading', 'gpu', 'preprocessing'],
  },
  {
    name: 'data-designer',
    product: 'Data Designer',
    description:
      'Build declarative synthetic dataset generation pipelines with NeMo Data Designer.',
    repoPath: 'skills/data-designer/SKILL.md',
    tags: ['nemo', 'synthetic-data', 'data-designer', 'llm'],
  },
  {
    name: 'deepstream-dev',
    product: 'DeepStream',
    description:
      'Agentic skill for guided NVIDIA DeepStream SDK vision AI and video analytics pipeline development.',
    repoPath: 'skills/deepstream-dev/SKILL.md',
    tags: ['deepstream', 'video-analytics', 'vision-ai', 'gstreamer'],
  },
  {
    name: 'doca-programming-guide',
    product: 'DOCA',
    description:
      'Teach AI agents to use the NVIDIA DOCA SDK on BlueField DPUs and ConnectX NICs — architecture, memory subsystem, core libraries, and programming patterns.',
    repoPath: 'skills/doca-programming-guide/SKILL.md',
    tags: ['doca', 'bluefield', 'dpu', 'connectx', 'networking'],
  },
  {
    name: 'dynamo-recipe-runner',
    product: 'Dynamo',
    description:
      'NVIDIA Dynamo distributed inference deployment bring-up on Kubernetes — pick and deploy recipes, router modes, and NIXL/UCX/NCCL interconnects.',
    repoPath: 'skills/dynamo-recipe-runner/SKILL.md',
    tags: ['dynamo', 'inference', 'kubernetes', 'nim'],
  },
  {
    name: 'earth2studio-discover',
    product: 'Earth2Studio',
    description:
      'Open-source deep-learning framework for exploring, building, and deploying AI weather and climate forecasting workflows.',
    repoPath: 'skills/earth2studio-discover/SKILL.md',
    tags: ['earth2studio', 'climate', 'weather', 'forecasting'],
  },
  {
    name: 'ethos-orchestrate',
    product: 'Ethos',
    description:
      'Capture an AI agent purpose, boundaries, and success criteria in a portable ethos.md specification.',
    repoPath: 'skills/ethos-orchestrate/SKILL.md',
    tags: ['ethos', 'agents', 'governance'],
  },
  {
    name: 'bionemo-drug-discovery-pipeline',
    product: 'BioNeMo NIMs',
    description:
      'Run and combine BioNeMo NIM microservices (Evo2, OpenFold, DiffDock, MolMIM, ProteinMPnn) for biomolecular research and drug discovery.',
    repoPath: 'skills/bionemo-drug-discovery-pipeline/SKILL.md',
    tags: ['bionemo', 'nim', 'drug-discovery', 'protein-design'],
  },
  {
    name: 'nvidia-ontology-query',
    product: 'Auto Ontology',
    description:
      'Model and publish semantic layers with NVIDIA Auto Ontology and run validated text-to-SQL queries.',
    repoPath: 'skills/nvidia-ontology-query/SKILL.md',
    tags: ['ontology', 'text-to-sql', 'rag'],
  },
];

/**
 * Returns the local cache directory for NVIDIA skills (~/.machcode/skills/nvidia).
 */
export function getNvidiaSkillsCacheDir(customBaseDir?: string): string {
  const base = customBaseDir ?? getConfigDir();
  return path.join(base, 'skills', 'nvidia');
}

/**
 * Parses YAML frontmatter from a SKILL.md string if present.
 */
export function parseSkillFrontmatter(markdown: string): {
  name?: string;
  description?: string;
  version?: string;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown.trim());
  if (!match) {
    return { body: markdown };
  }

  const yamlBlock = match[1] ?? '';
  const body = (match[2] ?? '').trim();

  const nameMatch = /^name:\s*["']?([^"'\r\n]+)["']?/m.exec(yamlBlock);
  const descMatch = /^description:\s*["']?([^"'\r\n]+)["']?/m.exec(yamlBlock);
  const versionMatch = /^version:\s*["']?([^"'\r\n]+)["']?/m.exec(yamlBlock);

  return {
    name: nameMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
    version: versionMatch?.[1]?.trim(),
    body,
  };
}

/**
 * Parses the Markdown skill catalog table from NVIDIA/skills README.md.
 */
export function parseSkillsCatalogFromReadme(readmeMarkdown: string): NvidiaSkillMetadata[] {
  const discovered: NvidiaSkillMetadata[] = [];
  const seen = new Set<string>();

  const rowRegex = /^\|\s*\*\*([^*|]+)\*\*\s*\|\s*([^|]+)\|\s*([^|]+)\|/gm;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(readmeMarkdown)) !== null) {
    const product = (rowMatch[1] ?? '').trim();
    const description = (rowMatch[2] ?? '').trim();
    const skillsCell = (rowMatch[3] ?? '').trim();

    const linkRegex = /\[`([^`]+)`\]\((skills\/[^)]+)\)/g;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(skillsCell)) !== null) {
      const skillName = (linkMatch[1] ?? '').trim();
      const skillFolder = (linkMatch[2] ?? '').trim().replace(/\/+$/, '');
      if (skillName && !seen.has(skillName)) {
        seen.add(skillName);
        discovered.push({
          name: skillName,
          product,
          description,
          repoPath: `${skillFolder}/SKILL.md`,
        });
      }
    }
  }

  return discovered.length > 0 ? discovered : OFFICIAL_NVIDIA_SKILLS_CATALOG;
}

/**
 * Automatically syncs the NVIDIA/skills catalog and caches it locally in ~/.machcode/skills/nvidia
 * (internal equivalent of `npx skills add NVIDIA/skills`).
 */
export async function syncNvidiaSkills(options?: {
  cacheDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<NvidiaSkillMetadata[]> {
  const cacheDir = getNvidiaSkillsCacheDir(options?.cacheDir);
  const catalogPath = path.join(cacheDir, 'catalog.json');
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;

  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });

  try {
    const response = await fetchImpl(`${NVIDIA_SKILLS_RAW_BASE_URL}/README.md`, {
      headers: { Accept: 'text/plain' },
    });

    if (response.ok) {
      const readmeText = await response.text();
      const parsedCatalog = parseSkillsCatalogFromReadme(readmeText);
      await fs.writeFile(catalogPath, JSON.stringify(parsedCatalog, null, 2), 'utf-8');
      return parsedCatalog;
    }
  } catch {
    // Fall back to cached catalog or built-in verified catalog
  }

  try {
    const cachedRaw = await fs.readFile(catalogPath, 'utf-8');
    const cached = JSON.parse(cachedRaw) as NvidiaSkillMetadata[];
    if (Array.isArray(cached) && cached.length > 0) {
      return cached;
    }
  } catch {
    // Ignore and write built-in catalog
  }

  await fs.writeFile(catalogPath, JSON.stringify(OFFICIAL_NVIDIA_SKILLS_CATALOG, null, 2), 'utf-8');
  return OFFICIAL_NVIDIA_SKILLS_CATALOG;
}

/**
 * Loads a specific NVIDIA skill's SKILL.md instructions from cache, GitHub (`NVIDIA/skills`),
 * or the built-in verified catalog fallback.
 */
export async function loadNvidiaSkill(
  skillName: string,
  options?: {
    cacheDir?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<LoadedNvidiaSkill> {
  const normalizedName = skillName.trim().toLowerCase();
  const cacheDir = getNvidiaSkillsCacheDir(options?.cacheDir);
  const skillCacheFile = path.join(cacheDir, normalizedName, 'SKILL.md');
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;

  const catalogMatch = OFFICIAL_NVIDIA_SKILLS_CATALOG.find((s) => s.name === normalizedName) ?? {
    name: normalizedName,
    product: 'NVIDIA',
    description: `NVIDIA Verified Agent Skill: ${normalizedName}`,
    repoPath: `skills/${normalizedName}/SKILL.md`,
  };

  // 1. Check local cache first
  try {
    const cachedMarkdown = await fs.readFile(skillCacheFile, 'utf-8');
    const parsed = parseSkillFrontmatter(cachedMarkdown);
    return {
      ...catalogMatch,
      description: parsed.description ?? catalogMatch.description,
      version: parsed.version,
      content: cachedMarkdown,
      source: 'cache',
    };
  } catch {
    // Not in local cache yet
  }

  // 2. Fetch live from https://raw.githubusercontent.com/NVIDIA/skills/main/skills/<name>/SKILL.md
  try {
    const url = `${NVIDIA_SKILLS_RAW_BASE_URL}/${catalogMatch.repoPath}`;
    const response = await fetchImpl(url, {
      headers: { Accept: 'text/plain' },
    });

    if (response.ok) {
      const remoteMarkdown = await response.text();
      await fs.mkdir(path.dirname(skillCacheFile), { recursive: true, mode: 0o700 });
      await fs.writeFile(skillCacheFile, remoteMarkdown, 'utf-8');

      const parsed = parseSkillFrontmatter(remoteMarkdown);
      return {
        ...catalogMatch,
        description: parsed.description ?? catalogMatch.description,
        version: parsed.version,
        content: remoteMarkdown,
        source: 'remote',
      };
    }
  } catch {
    // Fall back to synthesized skill instructions
  }

  // 3. Built-in verified fallback so offline execution never fails
  const fallbackMarkdown = [
    '---',
    `name: ${catalogMatch.name}`,
    `description: ${catalogMatch.description}`,
    '---',
    '',
    `# ${catalogMatch.product} — ${catalogMatch.name}`,
    '',
    catalogMatch.description,
    '',
    `Official NVIDIA Skill Repository Path: \`https://github.com/NVIDIA/skills/tree/main/skills/${catalogMatch.name}\``,
  ].join('\n');

  return {
    ...catalogMatch,
    content: fallbackMarkdown,
    source: 'builtin',
  };
}

/**
 * Generates the OpenAI Tool Calling definitions for NVIDIA official skills so they can be
 * automatically merged into MachCode's tool array without manual user configuration.
 */
export function getNvidiaSkillTools(
  catalog: NvidiaSkillMetadata[] = OFFICIAL_NVIDIA_SKILLS_CATALOG,
): OpenAIToolDefinition[] {
  const skillNames = catalog.map((skill) => skill.name);
  const catalogSummary = catalog
    .slice(0, 15)
    .map((s) => `${s.name} (${s.product}: ${s.description})`)
    .join('; ');

  return [
    {
      type: 'function',
      function: {
        name: 'load_nvidia_skill',
        description:
          `Loads an official NVIDIA-verified Agent Skill (SKILL.md) from https://github.com/NVIDIA/skills. ` +
          `Available skills include: ${catalogSummary}`,
        strict: true,
        parameters: {
          type: 'object',
          properties: {
            skillName: {
              type: 'string',
              description:
                'Exact slug of the NVIDIA skill to load (e.g. "cuopt-numerical-optimization-api", "accelerated-computing-cudf", "cudaq-guide").',
              enum: skillNames,
            },
          },
          required: ['skillName'],
          additionalProperties: false,
        },
      },
    },
  ];
}
