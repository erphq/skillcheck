import { z } from "zod";

const LegacyToolsField = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (Array.isArray(v)) return v;
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  });

function splitToolAllowlist(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let parenDepth = 0;

  for (const ch of value) {
    if (ch === "(") parenDepth++;
    if (ch === ")" && parenDepth > 0) parenDepth--;

    if ((ch === "," || /\s/.test(ch)) && parenDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) out.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed) out.push(trimmed);
  return out;
}

const AllowedToolsField = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    return splitToolAllowlist(v);
  });

export const SkillFrontmatter = z
  .object({
    name: z
      .string()
      .min(1, "name is required")
      .max(64, "name must be 64 characters or fewer")
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "name must use lowercase letters, numbers, and single hyphens only; it cannot start or end with a hyphen",
      ),
    description: z
      .string()
      .min(1, "description is required")
      .max(1024, "description must be 1024 characters or fewer"),
    license: z.string().optional(),
    compatibility: z
      .string()
      .max(500, "compatibility must be 500 characters or fewer")
      .optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    tools: LegacyToolsField,
    "allowed-tools": AllowedToolsField,
    model: z.string().optional(),
  })
  .passthrough();

export type SkillFrontmatterT = z.infer<typeof SkillFrontmatter>;
