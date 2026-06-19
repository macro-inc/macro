import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from 'ai';
import { z } from 'zod';

const execAsync = promisify(exec);

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s;
}

export type BashToolOptions = {
  /** Tool description shown to the model (overrides the generic default). */
  description?: string;
  /** Extra env vars exposed to commands, merged over `process.env`. */
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutput?: number;
  /** Post-process the command's combined output before it's returned to the
   *  model — e.g. validate an edited file or append a diff. */
  decorate?: (output: string) => string | Promise<string>;
};

/** A shell tool: runs one command and returns its combined stdout/stderr. */
export function createBashTool(opts: BashToolOptions = {}) {
  const {
    description = 'Run a shell command and return its combined stdout/stderr.',
    env = {},
    timeoutMs = 30_000,
    maxOutput = 20_000,
    decorate,
  } = opts;

  return tool({
    description,
    inputSchema: z.object({ command: z.string() }),
    execute: async ({ command }) => {
      console.error(`\n[bash]\n${command}`);
      let out = '';
      try {
        const { stdout, stderr } = await execAsync(command, {
          env: { ...process.env, ...env },
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        });
        out = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; message: string };
        out = `${err.stdout ?? ''}${err.stderr ?? ''}\n[exit error] ${err.message}`;
      }
      out = truncate(out, maxOutput);
      return decorate ? await decorate(out) : out;
    },
  });
}
