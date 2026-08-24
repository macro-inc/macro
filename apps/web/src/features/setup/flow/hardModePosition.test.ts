import { describe, expect, it } from 'vitest';

import {
  HARD_MODE_SWITCH_ZONE,
  randomSkipJumpDelayMs,
  randomSkipPosition,
  SKIP_JUMP_DELAY_MS,
} from './hardModePosition';

describe('randomSkipPosition', () => {
  it('uses the rng for both axes', () => {
    const values = [0, 0];
    let i = 0;
    const pos = randomSkipPosition(() => values[i++] ?? 0);
    expect(pos).toEqual({ left: 8, top: 8 });
  });

  it('keeps skip out of the hard-mode switch zone', () => {
    // First pair lands in the bottom-left reserved zone; the reroll must
    // push left past the switch.
    const values = [0, 1, 0];
    let i = 0;
    const pos = randomSkipPosition(() => values[i++] ?? 0);
    expect(pos.left).toBeGreaterThanOrEqual(HARD_MODE_SWITCH_ZONE.maxLeft);
    expect(pos.top).toBeGreaterThan(HARD_MODE_SWITCH_ZONE.minTop);
  });

  it('stays inside the padded surface across many draws', () => {
    for (let n = 0; n < 200; n++) {
      const pos = randomSkipPosition();
      expect(pos.left).toBeGreaterThanOrEqual(8);
      expect(pos.left).toBeLessThanOrEqual(92);
      expect(pos.top).toBeGreaterThanOrEqual(8);
      expect(pos.top).toBeLessThanOrEqual(90);
      const inSwitchZone =
        pos.left < HARD_MODE_SWITCH_ZONE.maxLeft &&
        pos.top > HARD_MODE_SWITCH_ZONE.minTop;
      expect(inSwitchZone).toBe(false);
    }
  });
});

describe('randomSkipJumpDelayMs', () => {
  it('is 200ms at rng 0 and 1500ms at rng 1', () => {
    expect(randomSkipJumpDelayMs(() => 0)).toBe(SKIP_JUMP_DELAY_MS.min);
    expect(randomSkipJumpDelayMs(() => 1)).toBe(SKIP_JUMP_DELAY_MS.max);
  });

  it('stays in 200–1500ms across many draws', () => {
    for (let n = 0; n < 200; n++) {
      const ms = randomSkipJumpDelayMs();
      expect(ms).toBeGreaterThanOrEqual(SKIP_JUMP_DELAY_MS.min);
      expect(ms).toBeLessThanOrEqual(SKIP_JUMP_DELAY_MS.max);
    }
  });
});
