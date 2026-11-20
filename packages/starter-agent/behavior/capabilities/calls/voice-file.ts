/**
 * The call's voice file, as Macro last committed it. Macro's agent settings
 * commit `config/voice.json` to the agent's repository; the live checkout
 * only gets it at its next pull. So a call fetches the remote's main and
 * reads the file there, and the checkout's copy when it can't.
 */
import { settings } from '../heartbeat/config.ts';
import type { Git } from '../heartbeat/repository.ts';
import { upstreamRef } from '../heartbeat/repository.ts';
import { voiceFile } from './config.ts';

/** How long a call waits on the fetch before using the checkout's voice. */
export const voiceFetchMs = 5000;

export const currentVoiceFile = async ({
  git,
  readLocal,
}: {
  readonly git: Git;
  readonly readLocal: () => Promise<string | undefined>;
}): Promise<string | undefined> => {
  const { remote, main } = settings;
  try {
    if ((await git(['fetch', '--quiet', remote, main])).code === 0) {
      const shown = await git([
        'show',
        `${upstreamRef({ remote, main })}:${voiceFile}`,
      ]);
      if (shown.code === 0) return shown.stdout;
    }
  } catch {
    // The checkout's copy, below.
  }
  return readLocal();
};
