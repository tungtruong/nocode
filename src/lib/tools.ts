import { getCapabilityDocs, isValidCapabilityName, CAPABILITY_NAMES } from "./jv-capabilities";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
}

const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description:
        "Read a file from the app's source code. Use this to see the current code before editing.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file, e.g. /style.css, /script.js, /index.html",
          },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description:
        "Make a precise surgical edit to a file. Replace old_string with new_string. The old_string must match exactly including whitespace. Use replace_all=true to replace all occurrences.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to edit",
          },
          old_string: {
            type: "string",
            description: "The exact string to replace (must be unique in the file)",
          },
          new_string: {
            type: "string",
            description: "The replacement string",
          },
          replace_all: {
            type: "boolean",
            description: "Replace all occurrences (default: false)",
            default: false,
          },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description:
        "Create a new file or completely overwrite an existing file. Use this for adding new files. For existing files, prefer edit_file.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path where to write the file",
          },
          content: {
            type: "string",
            description: "Full content of the file",
          },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "grep",
      description: "Search for a pattern in source files. Returns matching lines with line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Text or regex pattern to search for",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_capability_docs",
      description:
        "Fetch full docs + code examples for a JustVibe runtime capability the generated app can use. Capabilities: `forms` (collect submissions), `db` (read/write shared data via window.jv.db), `auth` (per-app end-user login via window.jv.auth). Call this BEFORE writing code that uses jv.db, jv.auth, or /f/<id>/submit forms — the base prompt only summarises them. Cheap (returns ~300-500 tokens once per capability per session).",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: [...CAPABILITY_NAMES],
            description: "Capability name to fetch docs for.",
          },
        },
        required: ["name"],
      },
    },
  },
];

export function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}

// Read-only subset for "Ask" mode — the agent can inspect the VFS to answer
// the user's question but can't write/edit. Used by /api/ask so questions
// like "tại sao nút không bấm được?" don't accidentally mutate files.
export function getReadOnlyToolDefinitions() {
  return TOOL_DEFINITIONS.filter((t) =>
    ["read_file", "grep", "get_capability_docs"].includes(t.function.name),
  );
}

export function executeTool(
  files: Record<string, string>,
  toolName: string,
  args: Record<string, unknown>
): string {
  switch (toolName) {
    case "read_file": {
      const path = args.file_path as string;
      return readFile(files, path);
    }
    case "edit_file": {
      const path = args.file_path as string;
      const oldStr = args.old_string as string;
      const newStr = args.new_string as string;
      const replaceAll = (args.replace_all as boolean) || false;
      return editFile(files, path, oldStr, newStr, replaceAll);
    }
    case "write_file": {
      const path = args.file_path as string;
      const content = args.content as string;
      return writeFile(files, path, content);
    }
    case "grep": {
      const pattern = args.pattern as string;
      return grepFiles(files, pattern);
    }
    case "get_capability_docs": {
      const name = String(args.name || "").trim();
      if (!isValidCapabilityName(name)) {
        return `Error: unknown capability "${name}". Available: ${CAPABILITY_NAMES.join(", ")}`;
      }
      return getCapabilityDocs(name);
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}

function readFile(files: Record<string, string>, path: string): string {
  const file = files[path];
  if (file === undefined) {
    return `Error: File not found: ${path}. Available files: ${Object.keys(files).join(", ")}`;
  }

  const lines = file.split("\n");
  const withLineNumbers = lines
    .map((line, i) => `${String(i + 1).padStart(4, " ")}| ${line}`)
    .join("\n");

  return `File: ${path} (${lines.length} lines, ${file.length} chars)\n\n${withLineNumbers}`;
}

function editFile(
  files: Record<string, string>,
  path: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): string {
  const file = files[path];
  if (file === undefined) {
    return `Error: File not found: ${path}. Use write_file to create a new file.`;
  }

  if (file === "" && oldString === "") {
    files[path] = newString;
    return `Created ${path} with initial content (${newString.length} chars)`;
  }

  if (oldString === "") {
    return `Error: old_string cannot be empty when file has content. Provide the exact text to replace.`;
  }

  const occurrences = file.split(oldString).length - 1;
  if (occurrences === 0) {
    return `Error: String not found in ${path}. The old_string must match exactly (including whitespace). Try reading the file first to see the exact content.`;
  }

  if (occurrences > 1 && !replaceAll) {
    return `Error: String appears ${occurrences} times in ${path}. Use replace_all=true to replace all, or provide a more specific string with surrounding context to target just one.`;
  }

  files[path] = file.split(oldString).join(newString);
  return `Successfully edited ${path}: replaced ${occurrences} occurrence(s).`;
}

function writeFile(
  files: Record<string, string>,
  path: string,
  content: string
): string {
  const existed = files[path] !== undefined;
  files[path] = content;
  return existed
    ? `Overwrote ${path} (${content.length} chars)`
    : `Created ${path} (${content.length} chars)`;
}

function grepFiles(files: Record<string, string>, pattern: string): string {
  const results: string[] = [];
  const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  for (const [path, content] of Object.entries(files)) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        results.push(`${path}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
      }
    }
  }

  if (results.length === 0) return `No matches found for "${pattern}"`;
  return results.slice(0, 30).join("\n") + (results.length > 30 ? `\n... and ${results.length - 30} more` : "");
}
