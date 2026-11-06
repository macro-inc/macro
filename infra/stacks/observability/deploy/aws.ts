import { execFileSync } from 'node:child_process';

export const ACCOUNT = '569036502058';
export const REGION = 'us-east-2';

// The AWS CLI, already on runners and operator machines, keeps these scripts
// free of SDK dependencies. Credentials come from the environment.
export function aws<T = Record<string, unknown>>(
  region: string,
  ...args: string[]
): T {
  const stdout = execFileSync(
    'aws',
    ['--region', region, '--output', 'json', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  );
  return (stdout.trim() ? JSON.parse(stdout) : {}) as T;
}

export function requireAccount(region: string): void {
  const identity = aws<{ Account: string }>(
    region,
    'sts',
    'get-caller-identity'
  );
  if (identity.Account !== ACCOUNT) {
    throw new Error(`Use the Macro AWS account (${ACCOUNT})`);
  }
}

export function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/** Poll `check` until it returns a value, or fail with `what` after `timeoutSeconds`. */
export async function waitFor<T>(
  what: string,
  timeoutSeconds: number,
  intervalSeconds: number,
  check: () => T | undefined | Promise<T | undefined>
): Promise<T> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutSeconds}s waiting for ${what}`);
    }
    await sleep(intervalSeconds);
  }
}

export interface Tag {
  Key: string;
  Value: string;
}

export function tagValue(
  tags: Tag[] | undefined,
  key: string
): string | undefined {
  return tags?.find((tag) => tag.Key === key)?.Value;
}
