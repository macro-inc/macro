import { spawn } from 'node:child_process';

/** Buffered process adapter used by git and executable checks. */
export async function runCommand(
  executable: string,
  options: {
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    clearEnv?: boolean;
    stdout?: 'piped' | 'inherit';
    stderr?: 'piped' | 'inherit';
  } = {}
): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
  const child = spawn(executable, options.args ?? [], {
    cwd: options.cwd,
    env: options.clearEnv
      ? (options.env ?? {})
      : { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
  return { code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

export async function stdinText(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) text += chunk.toString();
  return text;
}
