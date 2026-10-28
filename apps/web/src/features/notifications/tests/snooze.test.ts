import { describe, expect, it } from 'vitest';
import { snoozePresets } from '../core/snooze';

describe('notification snooze presets', () => {
  it('keeps Monday at 9 AM across daylight saving weekends', () => {
    for (const now of [new Date(2026, 2, 7, 12), new Date(2026, 9, 31, 12)]) {
      const monday = snoozePresets(now).find(
        (preset) => preset.id === 'weekend'
      )!.until;
      expect(monday.getDay()).toBe(1);
      expect(monday.getHours()).toBe(9);
      expect(monday.getMinutes()).toBe(0);
    }
  });

  it('uses the next local morning, including before 9 AM', () => {
    const before = new Date(2026, 8, 25, 8, 59);
    const at = new Date(2026, 8, 25, 9);
    expect(
      snoozePresets(before).find((p) => p.id === 'morning')?.until
    ).toEqual(new Date(2026, 8, 25, 9));
    expect(snoozePresets(at).find((p) => p.id === 'morning')?.until).toEqual(
      new Date(2026, 8, 26, 9)
    );
  });

  it('snoozes through the weekend to Monday morning', () => {
    for (const day of [25, 26, 27]) {
      const preset = snoozePresets(new Date(2026, 8, day, 17)).find(
        (p) => p.id === 'weekend'
      );
      expect(preset?.label).toBe('For the weekend');
      expect(preset?.until).toEqual(new Date(2026, 8, 28, 9));
    }
  });

  it('always offers future deadlines at month and year boundaries', () => {
    for (const now of [
      new Date(2026, 8, 28, 12),
      new Date(2026, 11, 31, 23, 59),
    ]) {
      expect(snoozePresets(now).every((option) => option.until > now)).toBe(
        true
      );
      expect(snoozePresets(now)[0].until.getTime() - now.getTime()).toBe(
        30 * 60_000
      );
    }
  });
});
