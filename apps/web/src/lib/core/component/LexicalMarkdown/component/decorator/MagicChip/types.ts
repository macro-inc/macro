import type { MagicChipData, MagicChipMessage } from '@macro-inc/lexical-core';

/** JSON arrays admitted by Source import have no named turn/author fields. */
export interface MagicChipArrayMessage extends ReadonlyArray<unknown> {
  readonly turn?: undefined;
  readonly author?: undefined;
}

/** Actual component inputs, including values retained by Source JSON import. */
export type MagicChipUIData = Omit<
  MagicChipData,
  'channelId' | 'promptedMessage'
> & {
  channelId?: string | null;
  promptedMessage: MagicChipMessage | MagicChipArrayMessage | null;
};
