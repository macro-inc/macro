import type {
  MagicChipData,
  MagicChipDecoratorProps,
} from '@macro-inc/lexical-core';
import type { JsonValue } from '@macro-inc/lexical-wasm-view/view/types';
import type { MagicChipUIData } from './types';

type Assignable<Input, Target> = [Input] extends [Target] ? true : false;
type Assert<Value extends true> = Value;

/** The real UI accepts admitted JSON without changing public node contracts. */
export type MagicChipUIInputControls = [
  Assert<Assignable<MagicChipData, MagicChipUIData>>,
  Assert<Assignable<MagicChipDecoratorProps, MagicChipUIData>>,
  Assert<Assignable<null, MagicChipUIData['channelId']>>,
  Assert<Assignable<JsonValue[], MagicChipUIData['promptedMessage']>>,
  Assert<Assignable<undefined, MagicChipUIData['promptedMessage']>>,
  Assert<Assignable<Omit<MagicChipData, 'promptedMessage'>, MagicChipUIData>>,
  Assert<
    Assignable<MagicChipUIData, MagicChipData> extends false ? true : false
  >,
];
