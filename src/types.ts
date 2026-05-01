export type Severity = "error" | "warn" | "info";

export interface Diagnostic {
  severity: Severity;
  rule: string;
  message: string;
  file: string;
  line?: number;
}

export interface ParsedSkill {
  file: string;
  raw: string;
  frontmatter: Record<string, unknown>;
  body: string;
  bodyStartLine: number;
}

export interface ValidatedSkill extends ParsedSkill {
  name: string;
  description: string;
  tools: string[];
}

export interface SkillcheckConfig {
  knownTools: Set<string>;
  mcpServers: Set<string>;
  cwd: string;
}
