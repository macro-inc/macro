/** Macro, as much of it as a greeting needs: the thin adapter over Macro's SDK. */
import type { Macro } from '@macro-inc/sdk';

export type GreetingMacro = {
  /** The owner's display name; undefined when they have none. */
  readonly ownerName: () => Promise<string | undefined>;
  /** The id of the agent's DM with its owner, opened if needed. */
  readonly ownerDm: () => Promise<string>;
  /** Whether anyone has written in a channel: one message read, no authors resolved. */
  readonly hasMessages: (channelId: string) => Promise<boolean>;
};

export const sdkGreetingMacro = (
  connect: () => Promise<Macro>,
  /** Read at each call: who the owner is can change while the agent runs. */
  owner: () => string
): GreetingMacro => ({
  ownerName: async () => {
    const macro = await connect();
    const name = (await macro.users.byId(owner()).name())?.trim();
    return name === undefined || name === '' ? undefined : name;
  },
  ownerDm: async () => {
    const macro = await connect();
    return (await macro.channels.dm(macro.users.byId(owner()))).id;
  },
  hasMessages: async (channelId) => {
    const macro = await connect();
    for await (const _message of macro.channels
      .byId(channelId)
      .messages({ pageSize: 1 }))
      return true;
    return false;
  },
});
