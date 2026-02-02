/**
 * Bash command execution tool for the office room.
 */
import { z } from "zod"
import type { ExecutableTool, ToolResult } from "../../types/rooms"
import { truncateOutput, OUTPUT_LIMITS, WORKSPACE_ROOT, DEFAULT_TIMEOUT } from "./utils"

/**
 * Execute a shell command.
 */
export const bash: ExecutableTool = {
  name: "bash",
  description:
    "Execute a shell command in the workspace. Use for operations not covered by specific tools. Output is truncated at 10k characters—use head, tail, or redirect to file for large outputs.",
  inputSchema: z.object({
    command: z.string().describe("The command to execute."),
  }),
  execute: async (params): Promise<ToolResult> => {
    const command = params.command as string

    try {
      const proc = Bun.spawn(["bash", "-c", command], {
        cwd: WORKSPACE_ROOT,
        timeout: DEFAULT_TIMEOUT,
        stderr: "pipe",
        stdout: "pipe",
      })

      // Capture both stdout and stderr
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])

      const exitCode = await proc.exited

      // Combine output
      let output = ""
      if (stdout) output += stdout
      if (stderr) {
        if (output && !output.endsWith("\n")) output += "\n"
        if (stderr.trim()) output += stderr
      }

      // Handle empty output
      if (!output.trim()) {
        output = exitCode === 0 ? "(no output)" : `(no output, exit code: ${exitCode})`
      }

      // Truncate if needed
      const truncated = truncateOutput(output.trim(), OUTPUT_LIMITS.bash)

      // Add exit code if non-zero and not already in output
      if (exitCode !== 0 && !truncated.includes(`exit code: ${exitCode}`)) {
        return {
          success: false,
          output: `${truncated}\n\n(exit code: ${exitCode})`,
        }
      }

      return {
        success: exitCode === 0,
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
