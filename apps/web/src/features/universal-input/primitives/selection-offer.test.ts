import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type Intent, intents, type Scores } from '../core/input';
import { createSelectionOffer } from './selection-offer';

function scored(intent: Intent): Scores {
  return intents.map((entry) => ({
    intent: entry,
    score: entry === intent ? 0.94 : 0.04,
  }));
}

/** A message whose whole text is selected, reported the way a browser would. */
function select(text: string) {
  const message = document.createElement('div');
  message.setAttribute('data-selection-offer', 'channel-message');
  message.append(document.createTextNode(text));
  document.body.append(message);
  vi.spyOn(document, 'getSelection').mockReturnValue({
    isCollapsed: false,
    anchorNode: message.firstChild,
    focusNode: message.firstChild,
    toString: () => text,
  } as unknown as Selection);
  document.dispatchEvent(new Event('selectionchange'));
  return message;
}

function clearSelection() {
  vi.spyOn(document, 'getSelection').mockReturnValue({
    isCollapsed: true,
    anchorNode: null,
    focusNode: null,
    toString: () => '',
  } as unknown as Selection);
  document.dispatchEvent(new Event('selectionchange'));
}

const cleanups: (() => void)[] = [];
function mount(classify: (text: string, revision: number) => Promise<Scores>) {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    return createSelectionOffer({
      classify: async (text, revision) => ({
        revision,
        scores: await classify(text, revision),
      }),
    });
  });
}
const tick = () => vi.advanceTimersByTimeAsync(600);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('offers the shape found in a settled selection', async () => {
  const classify = vi.fn(async () => scored('calendar'));
  const offer = mount(classify);
  const message = select('coffee at 8am tomorrow with the design team');
  await tick();
  expect(classify).toHaveBeenCalledTimes(1);
  expect(offer.offer()).toMatchObject({
    text: 'coffee at 8am tomorrow with the design team',
    surface: 'channel-message',
    container: message,
    intent: 'calendar',
  });
});

it('stays quiet when the shape belongs to Command K', async () => {
  const offer = mount(async () => scored('ai'));
  select('how does the billing pipeline decide proration');
  await tick();
  expect(offer.offer()).toBeUndefined();
});

it('keeps a held offer while the caret moves into the draft', async () => {
  const offer = mount(async () => scored('calendar'));
  select('coffee at 8am tomorrow with the design team');
  await tick();
  offer.hold();
  clearSelection();
  await tick();
  expect(offer.offer()).toMatchObject({ intent: 'calendar' });
});

it('does not offer the same passage again once dismissed', async () => {
  const classify = vi.fn(async () => scored('task'));
  const offer = mount(classify);
  select('ship the onboarding checklist before the release');
  await tick();
  expect(offer.offer()).toMatchObject({ intent: 'task' });
  offer.dismiss();
  document.dispatchEvent(new Event('selectionchange'));
  await tick();
  expect(offer.offer()).toBeUndefined();
  expect(classify).toHaveBeenCalledTimes(1);
});

it('discards a classification the reader has already moved past', async () => {
  let release: ((scores: Scores) => void) | undefined;
  const offer = mount(
    (text) =>
      new Promise<Scores>((resolve) => {
        if (text.startsWith('coffee')) release = resolve;
        else resolve(scored('task'));
      })
  );
  select('coffee at 8am tomorrow with the design team');
  await tick();
  select('ship the onboarding checklist before the release');
  await tick();
  release?.(scored('calendar'));
  await tick();
  expect(offer.offer()).toMatchObject({ intent: 'task' });
});
