import { $createInlineSearchNode } from '@macro-inc/lexical-core';
import { $getRoot, type ElementNode } from 'lexical';
import { afterEach, expect, it } from 'vitest';
import { createEmailEditor } from '../tests/editor';
import { fieldOwnsEscape } from './field-owns-escape';

afterEach(() => {
  document.body.replaceChildren();
});

it('leaves Escape to the composer while no field has anything open', () => {
  expect(fieldOwnsEscape(createEmailEditor('Hello'))).toBe(false);
  expect(fieldOwnsEscape(undefined)).toBe(false);
});

it('leaves Escape to an @ search open in the body', () => {
  const editor = createEmailEditor('Hello ');
  editor.update(
    () => {
      $getRoot()
        .getFirstChildOrThrow<ElementNode>()
        .append($createInlineSearchNode('@al'));
    },
    { discrete: true }
  );
  expect(fieldOwnsEscape(editor)).toBe(true);
});

it('leaves Escape to a recipient field showing suggestions', () => {
  const input = document.createElement('input');
  input.setAttribute('aria-expanded', 'true');
  document.body.append(input);
  input.focus();
  expect(fieldOwnsEscape(createEmailEditor())).toBe(true);
});
