import type { CreatableBlock } from '@app/features/command/types';
import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type { MobileNavViewId } from './mobile-nav-views';

// Tokens identify actions even when labels change or entries share a block type.
const PAGE_CREATE_TOKENS: Partial<Record<MobileNavViewId, HotkeyToken>> = {
  inbox: TOKENS.create.message,
  mail: TOKENS.create.email,
  channels: TOKENS.create.message,
  documents: TOKENS.create.note,
  tasks: TOKENS.create.task,
};

/** Resolve from the available launcher entries so feature gates apply here too. */
export function mobilePageCreateBlock(
  view: MobileNavViewId | undefined,
  blocks: readonly CreatableBlock[]
) {
  const token = view ? PAGE_CREATE_TOKENS[view] : undefined;
  if (!token) return undefined;

  return blocks.find((entry) => entry.hotkeyToken === token);
}
