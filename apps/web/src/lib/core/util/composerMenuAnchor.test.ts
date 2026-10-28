/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { composerMenuAnchorRect } from './composerMenuAnchor';

afterEach(() => {
  document.body.replaceChildren();
});

it('anchors to the Add button in the same composer', () => {
  document.body.innerHTML = `<div data-agent-composer><button data-composer-menu-anchor></button></div><div data-agent-composer><button data-composer-menu-anchor></button><button id="model"></button></div>`;
  const add = document.querySelectorAll<HTMLElement>(
    '[data-composer-menu-anchor]'
  )[1];
  const rect = new DOMRect(40, 100, 36, 36);
  vi.spyOn(add, 'getBoundingClientRect').mockReturnValue(rect);
  expect(composerMenuAnchorRect(document.getElementById('model')!)).toBe(rect);
});

it('uses the trigger when rendered outside a composer', () => {
  const trigger = document.createElement('button');
  const rect = new DOMRect(200, 50, 100, 36);
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(rect);
  expect(composerMenuAnchorRect(trigger)).toBe(rect);
  expect(composerMenuAnchorRect()).toBeUndefined();
});
