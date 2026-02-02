/**
 * Bash command execution tool for the office room.
 */
import { z } from "zod"
import type { ExecutableTool, ToolResult } from "../../types/rooms"
import { truncateOutput, OUTPUT_LIMITS, DEFAULT_TIMEOUT } from "./utils"

/**
 * Execute a shell command.
 */
export const bash: ExecutableTool = {
  name: "bash",
  persistResult: false,
  description:
    "Execute a shell command in the workspace. Use for operations not covered by specific tools. Output is truncated at 10k characters—use head, tail, or redirect to file for large outputs.",
  inputSchema: z.object({
    command: z.string().describe("The command to execute."),
  }),
  execute: async (params, context): Promise<ToolResult> => {
    const command = params.command as string

    try {
      const result = await context.workspace.exec(command, { timeout: DEFAULT_TIMEOUT })

      // Combine output
      let output = ""
      if (result.stdout) output += result.stdout
      if (result.stderr) {
        if (output && !output.endsWith("\n")) output += "\n"
        if (result.stderr.trim()) output += result.stderr
      }

      // Handle empty output
      if (!output.trim()) {
        output = result.exitCode === 0 ? "(no output)" : `(no output, exit code: ${result.exitCode})`
      }

      // Truncate if needed
      const truncated = truncateOutput(output.trim(), OUTPUT_LIMITS.bash)

      // Add exit code if non-zero and not already in output
      if (result.exitCode !== 0 && !truncated.includes(`exit code: ${result.exitCode}`)) {
        return {
          success: false,
          output: `${truncated}\n\n(exit code: ${result.exitCode})`,
        }
      }

      return {
        success: result.exitCode === 0,
        output: truncated,
      }
    } catch (error) {
      // Handle timeout
      if (error instanceof Error && error.message.includes("timeout")) {
        return {
          success: false,
          output: `Command timed out after ${DEFAULT_TIMEOUT / 1000} seconds.`,
        }
      }

      const message = error instanceof Error ? error.message : "Unknown error"
      return {
        success: false,
        output: `Failed to execute command: ${message}`,
      }
    }
  },
}
