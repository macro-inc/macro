import type { Script as ScriptOf } from '../../../../core/code.ts';

export type Context = { readonly greeting: string };

/** What a script of this pretend agent is given. */
export type Script = ScriptOf<Context>;

/** Greets someone by name. */
export const greet = async (
  { greeting }: Context,
  name: string,
  punctuation: string = '!'
): Promise<string> => `${greeting}, ${name}${punctuation}`;

export const shout = (context: Context, { name }: { readonly name: string }) =>
  greet(context, name.toUpperCase());

/** How many greetings there are. */
export const greetings = 1;

const defaults = { name: 'muppet', times: 1 };

/** Greets the default someone, unless told otherwise. */
export const greetDefault = (
  context: Context,
  input: Partial<typeof defaults> = {}
) => greet(context, { ...defaults, ...input }.name);
