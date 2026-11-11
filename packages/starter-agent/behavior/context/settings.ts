import { z } from 'zod';

/**
 * What makes this agent this agent and no other, apart from its secrets: who
 * it is in Macro, who owns it, and the name it commits under. It is a file in
 * the repository, `agent.json`, written by `bin/setup` and the agent's own to
 * change, e.g. when its owner gives it a name.
 */
export const Settings = z.object({
  /** The owner's Macro id, e.g. `macro|you@example.com`. Only this id gives orders. */
  owner: z.string().startsWith('macro|'),
  /** The agent's own Macro id: the account its API key belongs to. */
  me: z.string().startsWith('macro|'),
  /** The name and email the agent commits under. The name is also what it answers to on a call. */
  name: z.string().min(1),
  email: z.string().min(1),
  /** The zone a wall-clock time means: the owner's day, not the machine's. An IANA zone. */
  timeZone: z.string().min(1),
  /** The model every run is pinned to. */
  model: z.string().min(1),
});
export type Settings = z.infer<typeof Settings>;

/** The settings in a file's text. Throws, saying how to make the file, if there is none or it is wrong. */
export const parseSettings = (
  text: string | undefined,
  file: string
): Settings => {
  if (text === undefined)
    throw new Error(`${file} is missing: run bin/setup to create it`);
  const parsed = Settings.safeParse(JSON.parse(text));
  if (!parsed.success)
    throw new Error(`${file} is not valid: ${parsed.error.message}`);
  return parsed.data;
};
