import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createSelectionAnchor } from './selection-anchor';

function setup(initial: string[]) {
  const [items, setItems] = createSignal(initial);
  const [scope, setScope] = createSignal('jacob');
  const [index, setIndex] = createSignal(0);
  let dispose = () => {};
  const anchor = createRoot((cleanup) => {
    dispose = cleanup;
    return createSelectionAnchor({
      items,
      key: (item) => item,
      scope,
      selectedIndex: index,
      setSelectedIndex: setIndex,
    });
  });
  return { anchor, setItems, setScope, index, setIndex, dispose };
}

it('follows the chosen row when later results are inserted above it or reorder', () => {
  const menu = setup(['search', 'Jacob Adams', 'Jacob Baker', 'Jacob Clark']);
  menu.setIndex(2);
  menu.anchor.hold();

  menu.setItems([
    'search',
    'Jacob (CRM)',
    'Jacob Adams',
    'Jacob Clark',
    'Jacob Baker',
  ]);
  expect(menu.index()).toBe(4);
  expect(menu.anchor.present()).toBe(true);
  menu.dispose();
});

it('leaves an untouched default highlight on its position', () => {
  const menu = setup(['search', 'Jacob Adams']);
  menu.setIndex(1);
  menu.setItems(['search', 'Jacob (CRM)', 'Jacob Adams']);
  expect(menu.index()).toBe(1);
  menu.dispose();
});

it('waits for a held row that is briefly missing and drops it with the query', () => {
  const menu = setup(['search', 'Jacob Adams', 'Jacob Baker']);
  menu.setIndex(2);
  menu.anchor.hold();

  menu.setItems(['search']);
  expect(menu.anchor.present()).toBe(false);
  menu.setItems(['search', 'Jacob Clark', 'Jacob Baker']);
  expect(menu.index()).toBe(2);

  menu.setScope('jacobs');
  menu.setIndex(0);
  menu.setItems(['search', 'Jacobs Ladder', 'Jacob Baker']);
  expect(menu.index()).toBe(0);
  expect(menu.anchor.holding()).toBe(false);
  menu.dispose();
});
