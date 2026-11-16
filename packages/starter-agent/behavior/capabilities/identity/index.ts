/**
 * Identity: who the agent is, as its owner told it. One markdown file in its
 * memory, which the agent writes whole and is shown on every wake.
 */
import { behavior } from '@macro-inc/muppet/core/behavior';
import { module } from '@macro-inc/muppet/core/capability';
import type { Base } from '../../context/index.ts';

/** The state directory the identity lives in. */
export const owner = 'identity';
const identityFile = 'identity.md';

/** The little of the context identity needs, so a test can give it a fake. */
export type Needs = {
  readonly state: Pick<Base['state'], 'memory'>;
  readonly disk: Pick<Base['disk'], 'read' | 'write'>;
  readonly join: Base['join'];
};

const file = ({ state, join }: Pick<Needs, 'state' | 'join'>): string =>
  join(state.memory(owner), identityFile);

/**
 * What you have written about who you are, or undefined if you haven't yet.
 * It is already in your system prompt on every wake: read it here only from
 * a script.
 */
export const readIdentity = async (
  context: Needs
): Promise<string | undefined> => {
  const text = (await context.disk.read(file(context)))?.trim();
  return text === undefined || text === '' ? undefined : text;
};

/**
 * Writes who you are, replacing what was there.
 *
 * `markdown` is the whole of it, in your own words: your name, your purpose,
 * how you talk, what you care about, what you never do, the people you work
 * with. Only what your owner told you, or agreed to when you proposed it:
 * never a character you made up. Read what is there first and keep what is
 * still true. It is shown to you on every wake from the next one on.
 */
export const writeIdentity = async (
  context: Needs,
  { markdown }: { readonly markdown: string }
): Promise<void> => {
  const text = markdown.trim();
  if (text === '') throw new Error('markdown: empty identity');
  await context.disk.write(file(context), `${text}\n`);
};

export const identityModule = module({
  name: 'identity',
  summary:
    'Who you are, as your owner told you: read it, and rewrite it as you learn more.',
  file: import.meta.path,
  functions: { readIdentity, writeIdentity },
});

export const identityCapabilities = behavior<Base>().capability(identityModule);
