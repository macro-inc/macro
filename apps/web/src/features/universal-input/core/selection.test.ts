import { expect, it } from 'vitest';
import { type Intent, intents } from './input';
import {
  offeredIntent,
  type ReadableSelection,
  readSelectedText,
} from './selection';

function surface(name: string, text: string) {
  const element = document.createElement('div');
  element.setAttribute('data-selection-offer', name);
  element.append(document.createTextNode(text));
  document.body.append(element);
  return element;
}

function selected(anchor: Node, focus: Node, text: string): ReadableSelection {
  return {
    isCollapsed: false,
    anchorNode: anchor,
    focusNode: focus,
    toString: () => text,
  };
}

function scored(entries: Partial<Record<Intent, number>>) {
  return intents.map((intent) => ({ intent, score: entries[intent] ?? 0.02 }));
}

it('reads text that both ends of the selection share with one opted-in surface', () => {
  const message = surface(
    'channel-message',
    'coffee at 8am tomorrow sounds good'
  );
  const node = message.firstChild!;
  expect(
    readSelectedText(selected(node, node, ' coffee at 8am tomorrow '))
  ).toEqual({
    text: 'coffee at 8am tomorrow',
    surface: 'channel-message',
    container: message,
  });
});

it('ignores a drag across two surfaces, unmarked text, and a collapsed caret', () => {
  const first = surface('channel-message', 'lunch at noon on Friday');
  const second = surface('channel-message', 'and dinner at eight on Saturday');
  const loose = document.createElement('p');
  loose.append(document.createTextNode('dinner at eight on Saturday'));
  document.body.append(loose);
  expect(
    readSelectedText(
      selected(first.firstChild!, second.firstChild!, 'lunch and dinner')
    )
  ).toBeUndefined();
  expect(
    readSelectedText(
      selected(loose.firstChild!, loose.firstChild!, 'dinner at eight')
    )
  ).toBeUndefined();
  expect(
    readSelectedText({
      isCollapsed: true,
      anchorNode: first.firstChild,
      focusNode: first.firstChild,
      toString: () => 'lunch at noon on Friday',
    })
  ).toBeUndefined();
});

it('reads text an email body renders inside its shadow root', () => {
  const message = surface('email-message', '');
  const host = document.createElement('div');
  message.append(host);
  const body = host.attachShadow({ mode: 'open' });
  body.innerHTML =
    '<div><p><span>ship the checklist before Thursday</span></p></div>';
  const node = body.querySelector('span')!.firstChild!;
  expect(
    readSelectedText(selected(node, node, 'ship the checklist before Thursday'))
  ).toEqual({
    text: 'ship the checklist before Thursday',
    surface: 'email-message',
    container: message,
  });
});

it('offers nothing for a phrase too short to shape or a passage too long to capture', () => {
  const message = surface('channel-message', 'anything');
  const node = message.firstChild!;
  expect(readSelectedText(selected(node, node, 'see you'))).toBeUndefined();
  expect(
    readSelectedText(selected(node, node, 'word '.repeat(300)))
  ).toBeUndefined();
});

it('offers the top shape only when it is creatable and confident', () => {
  expect(offeredIntent(scored({ calendar: 0.91, note: 0.4 }))).toBe('calendar');
  expect(offeredIntent(scored({ task: 0.72, note: 0.71 }))).toBe('task');
  expect(offeredIntent(scored({ calendar: 0.44, note: 0.2 }))).toBeUndefined();
  expect(offeredIntent(scored({ ai: 0.95, note: 0.8 }))).toBeUndefined();
  expect(offeredIntent(scored({ search: 0.88, task: 0.7 }))).toBeUndefined();
  expect(offeredIntent([])).toBeUndefined();
});
