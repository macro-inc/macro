import { expect, test } from '@playwright/test';
import type {} from './readonly-text-fixture';

for (const mode of ['read', 'comment', 'ui', 'edit'] as const) {
  test(`outside characterData respects ${mode} editability without losing the text host`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/browser-test/readonly-text.html');
    await page.waitForFunction(() => Boolean(window.readonlyText));
    const result = await page.evaluate(
      (mode) => window.readonlyText.run(mode),
      mode
    );
    await info.attach('actual-native-text-observer', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
    expect(result.canonicalIdentity).toBe(true);
    expect(result.mounted).toBe(true);
    expect(result.errors).toEqual([]);
    expect(errors).toEqual([]);
    expect(result.editable).toBe(mode === 'edit');
    expect(result.editAuthority).toBe(mode === 'edit' || mode === 'ui');
    if (mode === 'edit') {
      expect(result.submissions).toBe(1);
      expect(result.text).toBe('Outside replacement.');
      expect(result.after.json).toContain('Outside replacement.');
    } else {
      expect(result.submissions).toBe(0);
      expect(result.text).toBe('Original text.');
      expect(result.after).toEqual(result.before);
    }
  });
}
