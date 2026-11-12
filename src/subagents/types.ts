export interface SubagentDefinition {
  id: string;
  name: string;
  mention: string;
  description: string;
  preferredModelPatterns: string[];
  systemPrompt: string;
  nvidiaSkillTags?: string[];
  defaultMode?: 'build' | 'plan';
}

export interface ParseSubagentResult {
  subagent?: SubagentDefinition;
  cleanedPrompt: string;
}
