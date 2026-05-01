import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { ParsedSkill } from "./types.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export class ParseError extends Error {
  readonly file: string;
  constructor(message: string, file: string) {
    super(message);
    this.name = "ParseError";
    this.file = file;
  }
}

export async function parseSkillFile(file: string): Promise<ParsedSkill> {
  const raw = await readFile(file, "utf8");
  return parseSkillContent(file, raw);
}

export function parseSkillContent(file: string, raw: string): ParsedSkill {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) {
    throw new ParseError(
      "missing or malformed frontmatter (expected --- ... ---)",
      file,
    );
  }
  const yamlText = m[1] ?? "";
  let fm: unknown;
  try {
    fm = parseYaml(yamlText);
  } catch (e) {
    throw new ParseError(
      `invalid YAML in frontmatter: ${(e as Error).message}`,
      file,
    );
  }
  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) {
    throw new ParseError("frontmatter must be a YAML mapping", file);
  }
  const body = raw.slice(m[0].length);
  const bodyStartLine = raw.slice(0, m[0].length).split(/\r?\n/).length;
  return {
    file,
    raw,
    frontmatter: fm as Record<string, unknown>,
    body,
    bodyStartLine,
  };
}
