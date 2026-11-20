/**
 * The agent's entrypoint: run its behavior. Run with
 * `bun examples/mail-triage/index.ts`, or with MUPPET_CLAUDE=1 to wake real
 * Claude Code.
 */
import { join } from 'node:path';
import { simple } from '../../runtimes/simple.ts';
import { scripts } from '../scripts.ts';
import { muppet } from './behavior.ts';

const directory = import.meta.dir;
const agentFile = 'AGENT.md';
const behaviorFile = 'behavior.ts';
// Only the first mail wakes the agent: the second is the same day, the third isn't important.
await muppet.run(
  simple({
    systemPrompt: await Bun.file(join(directory, agentFile)).text(),
    ...scripts(directory, {
      file: join(directory, behaviorFile),
      name: 'Script',
    }),
  })
);
