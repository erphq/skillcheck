import { z } from "zod";

export const SkillFrontmatter = z
  .object({
    name: z.string().min(1, "name is required"),
    description: z.string().min(1, "description is required"),
    tools: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        if (Array.isArray(v)) return v;
        return v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }),
    model: z.string().optional(),
  })
  .passthrough();

export type SkillFrontmatterT = z.infer<typeof SkillFrontmatter>;
