/**
 * The runner's side of the browser host: it starts `node src/browser-host.ts`
 * with the allowlisted environment, sends one request at a time and reads
 * one reply per request. Under Bun, Playwright's pipe to Chromium sometimes
 * stops delivering messages (a launch that never settles, a locator call
 * never answered), so Playwright runs in Node, its own runtime, and Bun only
 * exchanges these typed messages with it.
 */
import { join } from 'node:path';
import { hostEnvironment } from './browser-options.ts';
import {
  type HostReply,
  HostReply as HostReplySchema,
  type HostRequest,
} from './host-protocol.ts';

const HOST_SCRIPT = join(import.meta.dir, 'browser-host.ts');

export type BrowserHost = {
  request: (message: HostRequest) => Promise<HostReply>;
  /** Kills the host (and with its pipes, its Chromium) at once. */
  kill: () => void;
};

/** Starts a host, or undefined when there is no `node` to run it. */
export const startBrowserHost = (): BrowserHost | undefined => {
  const env = hostEnvironment();
  const node = Bun.which('node', { PATH: env.PATH ?? '' });
  if (node === null) return undefined;

  const child = Bun.spawn([node, HOST_SCRIPT], {
    env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  /** The next line the host writes; rejects if the host ends first. */
  const nextLine = async (): Promise<string> => {
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        return line;
      }
      const chunk = await reader.read();
      if (chunk.done) throw new Error('browser host ended');
      buffered += decoder.decode(chunk.value, { stream: true });
    }
  };

  return {
    request: async (message) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
      await child.stdin.flush();
      const reply = HostReplySchema.safeParse(JSON.parse(await nextLine()));
      if (!reply.success) throw new Error('malformed host reply');
      return reply.data;
    },
    kill: () => child.kill('SIGKILL'),
  };
};
