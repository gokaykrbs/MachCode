import chalk from 'chalk';
import {
  OFFICIAL_NVIDIA_SKILLS_CATALOG,
  loadNvidiaSkill,
  type NvidiaSkillMetadata,
} from '../tools/nvidiaSkills.js';
import type { SlashCommand, CommandContext } from './types.js';

/**
 * Resolves a shorthand or full skill name to an official NVIDIA skill metadata entry.
 */
export function resolveSkillByName(input: string): NvidiaSkillMetadata | null {
  const query = input.trim().toLowerCase();
  if (!query) {
    return null;
  }

  // 1. Exact slug match
  const exactSlug = OFFICIAL_NVIDIA_SKILLS_CATALOG.find((s) => s.name.toLowerCase() === query);
  if (exactSlug) {
    return exactSlug;
  }

  // 2. Exact product match
  const exactProduct = OFFICIAL_NVIDIA_SKILLS_CATALOG.find(
    (s) => s.product.toLowerCase() === query,
  );
  if (exactProduct) {
    return exactProduct;
  }

  // 3. Shorthand alias mappings
  const aliasMap: Record<string, string> = {
    cudf: 'accelerated-computing-cudf',
    cuopt: 'cuopt-routing-api-python',
    routing: 'cuopt-routing-api-python',
    milp: 'cuopt-numerical-optimization-api',
    lp: 'cuopt-numerical-optimization-api',
    cudaq: 'cudaq-guide',
    quantum: 'cudaq-guide',
    deepstream: 'deepstream-dev',
    vision: 'deepstream-dev',
    doca: 'doca-programming-guide',
    dpu: 'doca-programming-guide',
    dali: 'dali-dynamic-mode',
    bionemo: 'bionemo-drug-discovery-pipeline',
    drug: 'bionemo-drug-discovery-pipeline',
    dynamo: 'dynamo-recipe-runner',
    datadesigner: 'data-designer',
    earth2: 'earth2studio-discover',
    ethos: 'ethos-orchestrate',
    ontology: 'nvidia-ontology-query',
    sql: 'nvidia-ontology-query',
  };

  const mappedSlug = aliasMap[query.replace(/[-_]/g, '')];
  if (mappedSlug) {
    const found = OFFICIAL_NVIDIA_SKILLS_CATALOG.find((s) => s.name === mappedSlug);
    if (found) {
      return found;
    }
  }

  // 4. Tag or substring match
  return (
    OFFICIAL_NVIDIA_SKILLS_CATALOG.find(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.product.toLowerCase().includes(query) ||
        (s.tags && s.tags.some((t) => t.toLowerCase() === query)),
    ) ?? null
  );
}

export const skillsCommand: SlashCommand = {
  name: 'skills',
  description: 'List and run tasks with official NVIDIA Agent Skills',
  category: 'Execution & Modes',
  usage: '/skills [name] [task]',
  aliases: ['skill', 'nvskills'],
  execute: async (args: string, context: CommandContext) => {
    const parts = args.trim().split(/\s+/);
    const firstWord = parts[0];

    // If no argument is provided, display the full interactive catalog of skills
    if (!firstWord || firstWord.length === 0) {
      console.log(
        '\n' +
          chalk.cyan.bold('══════════════════════════════════════════════════════════════════') +
          '\n' +
          chalk.cyan.bold('              NVIDIA OFFICIAL AGENT SKILLS CATALOG') +
          '\n' +
          chalk.cyan.bold('══════════════════════════════════════════════════════════════════\n'),
      );

      console.log(
        chalk.gray(
          'Integrated from https://github.com/NVIDIA/skills. Automatically available to all models.\n',
        ),
      );

      for (const skill of OFFICIAL_NVIDIA_SKILLS_CATALOG) {
        console.log(
          `  ${chalk.green.bold('•')} ${chalk.white.bold(skill.product.padEnd(16))} ${chalk.cyan(`/skill ${skill.name}`)}`,
        );
        console.log(`    ${chalk.dim(skill.description)}`);
      }

      console.log(
        '\n' +
          chalk.yellow('Tip:') +
          chalk.gray(' Run ') +
          chalk.white.bold('/skill <name> <task>') +
          chalk.gray(' to execute with a specific skill, or type ') +
          chalk.white.bold('/cuopt') +
          chalk.gray(', ') +
          chalk.white.bold('/cudf') +
          chalk.gray(', etc.\n'),
      );
      return;
    }

    const matched = resolveSkillByName(firstWord);
    if (!matched) {
      console.log(
        chalk.red(
          `\n✖ Unknown NVIDIA skill "${firstWord}". Type /skills to view available skills.\n`,
        ),
      );
      return;
    }

    const promptText = parts.slice(1).join(' ').trim();

    try {
      console.log(
        chalk.cyan(`\n⚡ Loading NVIDIA Skill: `) +
          chalk.white.bold(`${matched.product} (${matched.name})`) +
          '...\n',
      );
      const loaded = await loadNvidiaSkill(matched.name, {
        fetchImpl: context.fetchImpl,
      });

      if (!promptText) {
        // Skill activated into session
        context.sessionHistory.push({
          role: 'user',
          content: `[ACTIVATED NVIDIA SKILL: ${loaded.product} - ${loaded.name}]\n${loaded.content}`,
        });
        context.sessionHistory.push({
          role: 'assistant',
          content: `I have loaded the official NVIDIA guidance for ${loaded.product} (${loaded.name}). I am ready to assist with ${loaded.description}.`,
        });

        console.log(
          chalk.green.bold(`✔ Successfully activated `) +
            chalk.white.bold(loaded.product) +
            chalk.green(` skill in session context!\n`) +
            chalk.dim(`   ${loaded.description}\n`),
        );
        return;
      }

      // Execute task directly with the skill context injected
      const enrichedPrompt = `[ACTIVE NVIDIA SKILL: ${loaded.product} - ${loaded.name}]\n${loaded.content}\n\n[USER TASK]:\n${promptText}`;
      await context.runMachCode(enrichedPrompt);
    } catch (err) {
      console.error(chalk.red(`✖ Failed to load NVIDIA skill: ${String(err)}`));
    }
  },
};

/**
 * Creates direct convenience commands for popular NVIDIA skills (e.g. /cuopt, /cudf, /cudaq).
 */
export function createSkillShortcut(
  name: string,
  skillSlug: string,
  productName: string,
  description: string,
): SlashCommand {
  return {
    name,
    description: `${productName}: ${description}`,
    category: 'Execution & Modes',
    usage: `/${name} [prompt]`,
    execute: async (args: string, context: CommandContext) => {
      const fullArgs = args ? `${skillSlug} ${args}` : skillSlug;
      await skillsCommand.execute(fullArgs, context);
    },
  };
}

export const skillShortcutCommands: SlashCommand[] = [
  createSkillShortcut(
    'cuopt',
    'cuopt-routing-api-python',
    'cuOpt',
    'GPU vehicle routing & LP/MILP optimization',
  ),
  createSkillShortcut(
    'cudf',
    'accelerated-computing-cudf',
    'cuDF',
    'GPU DataFrames, pandas acceleration & ETL',
  ),
  createSkillShortcut('cudaq', 'cudaq-guide', 'CUDA-Q', 'Quantum-classical hybrid programming'),
  createSkillShortcut(
    'deepstream',
    'deepstream-dev',
    'DeepStream',
    'Vision AI & video analytics pipelines',
  ),
  createSkillShortcut(
    'doca',
    'doca-programming-guide',
    'DOCA',
    'BlueField DPU & ConnectX networking',
  ),
  createSkillShortcut('dali', 'dali-dynamic-mode', 'DALI', 'GPU data loading & preprocessing'),
  createSkillShortcut(
    'bionemo',
    'bionemo-drug-discovery-pipeline',
    'BioNeMo',
    'Biomolecular drug discovery & protein design',
  ),
  createSkillShortcut(
    'dynamo',
    'dynamo-recipe-runner',
    'Dynamo',
    'Distributed LLM inference on Kubernetes',
  ),
];

export const skillsCommands: SlashCommand[] = [skillsCommand, ...skillShortcutCommands];
