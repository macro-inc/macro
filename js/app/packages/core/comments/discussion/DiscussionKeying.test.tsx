/**
 * @vitest-environment jsdom
 */
import { Key } from '@solid-primitives/keyed';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { Accessor } from 'solid-js';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';

type Item = {
  id: string;
  label: string;
};

function Row(props: {
  item: Accessor<Item>;
  mounts: Map<string, number>;
  cleanups: Map<string, number>;
}) {
  const id = props.item().id;

  onMount(() => {
    props.mounts.set(id, (props.mounts.get(id) ?? 0) + 1);
  });
  onCleanup(() => {
    props.cleanups.set(id, (props.cleanups.get(id) ?? 0) + 1);
  });

  return <div data-testid={id}>{props.item().label}</div>;
}

describe('discussion keyed lists', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps row owners mounted when item objects are replaced with the same ids', () => {
    const [items, setItems] = createSignal<Item[]>([
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ]);
    const mounts = new Map<string, number>();
    const cleanups = new Map<string, number>();

    render(() => (
      <Key each={items()} by="id">
        {(item) => <Row item={item} mounts={mounts} cleanups={cleanups} />}
      </Key>
    ));

    expect(mounts.get('a')).toBe(1);
    expect(mounts.get('b')).toBe(1);

    setItems([
      { id: 'a', label: 'Alpha updated' },
      { id: 'b', label: 'Beta updated' },
      { id: 'c', label: 'Gamma' },
    ]);

    expect(screen.getByTestId('a').textContent).toBe('Alpha updated');
    expect(screen.getByTestId('b').textContent).toBe('Beta updated');
    expect(screen.getByTestId('c').textContent).toBe('Gamma');
    expect(mounts.get('a')).toBe(1);
    expect(mounts.get('b')).toBe(1);
    expect(mounts.get('c')).toBe(1);
    expect(cleanups.get('a')).toBeUndefined();
    expect(cleanups.get('b')).toBeUndefined();

    setItems([{ id: 'b', label: 'Beta final' }]);

    expect(screen.queryByTestId('a')).toBeNull();
    expect(screen.getByTestId('b').textContent).toBe('Beta final');
    expect(screen.queryByTestId('c')).toBeNull();
    expect(mounts.get('b')).toBe(1);
    expect(cleanups.get('a')).toBe(1);
    expect(cleanups.get('b')).toBeUndefined();
    expect(cleanups.get('c')).toBe(1);
  });
});
