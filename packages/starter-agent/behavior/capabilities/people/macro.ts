import type { Macro } from '@macro-inc/sdk';

/** Who wrote a message, by Macro's record, and whether it was in a DM. */
export type Author = {
  readonly id: string;
  readonly name: string | undefined;
  readonly dm: boolean;
};

/** The author of a message, from Macro's record, never from anything it says. */
export type AuthorOf = (
  channelId: string,
  messageId: string
) => Promise<Author>;

const directMessage = 'direct_message';

export const sdkAuthorOf =
  (connect: () => Promise<Macro>): AuthorOf =>
  async (channelId, messageId) => {
    const macro = await connect();
    const channel = macro.channels.byId(channelId);
    const author = await channel.message(messageId).author();
    return {
      id: author.id,
      name: await author.name().catch(() => undefined),
      dm: (await channel.type()) === directMessage,
    };
  };
