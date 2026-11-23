import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { claudeCode } from '../../agents/claude-code.ts';
import type { Agent } from '../../core/agent.ts';
import { mail } from './capabilities.ts';

const behaviorFile = join(import.meta.dir, 'behavior.ts');

/** Stands in for Claude: on a wake, reads its docs and runs a script the way the agent would. */
const standIn: Agent = {
  wake: async ({ request, systemPrompt, event, state }) => {
    console.log('request:', request);
    console.log('event:', event);
    console.log('system prompt:', systemPrompt);
    console.log(await state.code.describe([mail.name]));
    const imports = `
import type { Script } from ${JSON.stringify(behaviorFile)};
import { triageMail } from ${JSON.stringify(mail.file)};
`;
    console.log(
      'RunCapabilityScript:',
      await state.code.execute(`${imports}
export async function main({ context, log }: Script) {
	log("triaging from a script");
	return await triageMail(context, { from: "boss@example.com", subject: "Production is down" });
}
`)
    );
    console.log(
      'RunCapabilityScript with a type error:',
      await state.code.execute(`${imports}
export async function main({ context }: Script) {
	return await triageMail(context, { subject: 1 });
}
`)
    );
    return { kind: 'done', reply: 'Looked into the outage.' };
  },
};

/** Real Claude Code when MUPPET_CLAUDE is set, otherwise the stand-in. */
export const agent: Agent = process.env.MUPPET_CLAUDE
  ? claudeCode({ query })
  : standIn;
