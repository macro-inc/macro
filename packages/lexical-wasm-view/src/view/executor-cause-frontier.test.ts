// @vitest-environment jsdom
import {
  type DecodedViewEffect,
  Flag,
} from '@macro-inc/collaboration/session/output';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeKeyboardSurface,
  nativeAcknowledgementSurface,
} from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/editing/test/native-keyboard-surface';

let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeNativeKeyboardSurface();
});
afterAll(() => restore?.());
afterEach(() => vi.restoreAllMocks());

test('DEV production mount accepts a DOM echo and the next healthy echo without a cause lookup', async () => {
  const fixture = await nativeAcknowledgementSurface();
  const lookup = vi.spyOn(fixture.session, 'takeCodeTokenFailure');
  const acknowledge = vi.spyOn(fixture.view, 'acknowledgeText');
  try {
    for (const value of ['ab😀', 'ab😀!']) {
      const text = fixture.view.getElementByKey(fixture.leaf.key)?.firstChild;
      if (!text) throw new Error('Missing actual text DOM');
      text.textContent = value;
      fixture.port.textFromView({
        key: fixture.leaf.key,
        text: value,
        anchorOffset: value.length,
        focusOffset: value.length,
      });
      expect(fixture.view.node(fixture.leaf.key)?.text).toBe(value);
      expect(fixture.session.nodeText(fixture.leaf.key)).toBe(value);
    }
    expect(acknowledge).toHaveBeenCalledTimes(2);
    expect(lookup).not.toHaveBeenCalled();
  } finally {
    await fixture.close();
  }
});

test.each([
  { label: 'undefined', cause: undefined },
  { label: 'null', cause: null },
  { label: 'opaque object', cause: { opaque: true } },
])(
  'the real executor binds a View-only follow-up $label cause exactly once',
  async ({ cause }) => {
    const fixture = await nativeAcknowledgementSurface(
      undefined,
      undefined,
      undefined,
      {
        primeEcho: false,
        codeTokens: {
          profile: 'native-ack-cause-control',
          provider: (operation) => {
            if (operation === 'loaded')
              return JSON.stringify({ kind: 'loaded', loaded: true });
            throw cause;
          },
        },
      }
    );
    const lookup = vi.spyOn(fixture.session, 'takeCodeTokenFailure');
    const effects: DecodedViewEffect[] = [];
    const apply = fixture.view.apply.bind(fixture.view);
    vi.spyOn(fixture.view, 'apply').mockImplementation(
      (words, strings, output = []) => {
        effects.push(...output);
        apply(words, strings, output);
      }
    );
    const flags: number[] = [];
    const input = fixture.session.input.bind(fixture.session);
    vi.spyOn(fixture.session, 'input').mockImplementation((...args) => {
      const result = input(...args);
      flags.push(result);
      return result;
    });
    try {
      try {
        fixture.port.setState(
          JSON.stringify({
            root: {
              type: 'root',
              version: 1,
              children: [
                {
                  type: 'custom-code',
                  version: 1,
                  language: 'rust',
                  children: [
                    { type: 'text', version: 1, text: 'fn main() {}' },
                  ],
                },
              ],
            },
          })
        );
      } catch {
        // The actual published failure effect and opaque cause are asserted below.
      }
      // View-only means no Error flag; real session IO may accompany the failure.
      expect(flags[0] & Flag.View).toBe(Flag.View);
      expect(flags[0] & Flag.Error).toBe(0);
      const failed = effects.find(
        (effect) => effect.kind === 6 && effect.code === 10
      );
      expect(failed).toBeDefined();
      expect(failed).toHaveProperty('codeTokenCause');
      expect(failed?.codeTokenCause?.value).toBe(cause);
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.close();
    }
  }
);
