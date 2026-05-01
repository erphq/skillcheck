// Known built-in Claude Code tool names. Keep alphabetized.
export const BUILTIN_TOOLS: ReadonlySet<string> = new Set([
  "Agent",
  "AskUserQuestion",
  "Bash",
  "BashOutput",
  "CronCreate",
  "CronDelete",
  "CronList",
  "Edit",
  "EnterPlanMode",
  "EnterWorktree",
  "ExitPlanMode",
  "ExitWorktree",
  "Glob",
  "Grep",
  "KillShell",
  "Monitor",
  "MultiEdit",
  "NotebookEdit",
  "PushNotification",
  "Read",
  "RemoteTrigger",
  "ScheduleWakeup",
  "Skill",
  "SlashCommand",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "TodoWrite",
  "ToolSearch",
  "WebFetch",
  "WebSearch",
  "Write",
]);

export function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__");
}

export interface McpToolRef {
  server: string;
  tool: string;
}

export function parseMcpToolName(name: string): McpToolRef | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const sep = rest.indexOf("__");
  if (sep === -1 || sep === 0) return null;
  const tool = rest.slice(sep + 2);
  if (tool.length === 0) return null;
  return { server: rest.slice(0, sep), tool };
}
