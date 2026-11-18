// @vitest-environment jsdom
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { expect, test, vi } from 'vitest';
import type { CodeAccessoryHost } from '../../component/accessory/code-accessory-host';

const rendered: CodeAccessoryHost[] = [];
vi.mock('../../component/accessory/CodeBoxAccessory', () => ({
  CodeBoxAccessory: (props: { host: CodeAccessoryHost }) => {
    rendered.push(props.host);
    return null;
  },
}));

const { createNativeCodeAccessories } = await import('./native-accessory');

/**
 * CONSUMER-ONLY stub: the EditorView slice the accessory host reads. It proves
 * what the accessories do with a supplied mirror, editability and mutation,
 * not when a real session reports ready.
 */
function stubView(initiallyEditable: boolean) {
  let editable = initiallyEditable;
  const element = document.createElement('code');
  const mutations = new Set<(changes: ReadonlyMap<number, string>) => void>();
  const node = {
    key: 5,
    type: 'custom-code',
    kind: 'element',
    children: [],
    props: () => ({ language: 'rust' }),
  };
  const view = {
    mirror: { values: () => [node].values() },
    node: (key: number) => (key === 5 ? node : undefined),
    getElementByKey: (key: number) => (key === 5 ? element : null),
    get isEditable() {
      return editable;
    },
    root: document.createElement('div'),
    onMutations: (
      _type: string,
      listener: (changes: ReadonlyMap<number, string>) => void
    ) => {
      mutations.add(listener);
      return () => mutations.delete(listener);
    },
  } as unknown as EditorView;
  const dispatch = (mutation: string) => {
    for (const listener of mutations) listener(new Map([[5, mutation]]));
  };
  const setEditable = (next: boolean) => {
    editable = next;
  };
  return { view, dispatch, setEditable };
}

function renderHost(store: Record<string, { component: unknown }>) {
  const component = store['5']!.component as (props: { ref: unknown }) => void;
  rendered.length = 0;
  component({ ref: undefined });
  return rendered[0]!;
}

// Outcome oracle: Source (OFF) opens an editable document's code blocks with the
// language menu and delete controls. How Source arrives there is not asserted.
test('an editable block mounted before ready becomes editable at ready', () => {
  let ready = false;
  const { view } = stubView(true);
  const accessories = createNativeCodeAccessories(view, { ready: () => ready });
  expect(renderHost(accessories.store).editableAtMount).toBe(false);
  ready = true;
  accessories.refreshEditable();
  expect(renderHost(accessories.store).editableAtMount).toBe(true);
  accessories.dispose();
});

test('a later mutation of a block mounted before ready reads current editability', () => {
  let ready = false;
  const { view, dispatch } = stubView(true);
  const accessories = createNativeCodeAccessories(view, { ready: () => ready });
  ready = true;
  dispatch('updated');
  expect(renderHost(accessories.store).editableAtMount).toBe(true);
  accessories.dispose();
});

test('a read-only document keeps read-only headers at ready', () => {
  let ready = false;
  const { view } = stubView(false);
  const accessories = createNativeCodeAccessories(view, { ready: () => ready });
  ready = true;
  accessories.refreshEditable();
  expect(renderHost(accessories.store).editableAtMount).toBe(false);
  accessories.dispose();
});

// RME refreshes after every editability change (permissions can resolve after
// the first full reconcile).
test('a block becomes editable when editability arrives after ready', () => {
  let ready = false;
  const { view, setEditable } = stubView(false);
  const accessories = createNativeCodeAccessories(view, { ready: () => ready });
  ready = true;
  accessories.refreshEditable();
  expect(renderHost(accessories.store).editableAtMount).toBe(false);
  setEditable(true);
  accessories.refreshEditable();
  expect(renderHost(accessories.store).editableAtMount).toBe(true);
  accessories.dispose();
});

// Source's host reads editability once; losing edit access later does not
// rebuild an existing editable header.
test('an editable header stays when editability is later lost', () => {
  const { view, setEditable } = stubView(true);
  const accessories = createNativeCodeAccessories(view, { ready: () => true });
  expect(renderHost(accessories.store).editableAtMount).toBe(true);
  setEditable(false);
  accessories.refreshEditable();
  expect(renderHost(accessories.store).editableAtMount).toBe(true);
  accessories.dispose();
});
