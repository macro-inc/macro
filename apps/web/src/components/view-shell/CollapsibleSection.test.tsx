/** @vitest-environment jsdom */
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createResource, createSignal, Show, Suspense } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CollapsibleSection } from './CollapsibleSection';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => vi.unstubAllGlobals());

it('keeps the header and sibling sections attached while reopened content suspends', async () => {
  const pending: ((value: string) => void)[] = [];
  function DeferredRows() {
    const [value] = createResource(
      () => new Promise<string>((resolve) => pending.push(resolve))
    );
    return <span>{value()}</span>;
  }
  const [open, setOpen] = createSignal(false);
  const view = render(() => (
    <Suspense fallback={<div>Outer loading</div>}>
      <CollapsibleSection.Root open={open()} onOpenChange={setOpen}>
        <CollapsibleSection.Trigger>
          Favorites
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        <CollapsibleSection.Content>
          <Show when={open()}>
            <DeferredRows />
          </Show>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
      <div>Adjacent section</div>
    </Suspense>
  ));
  const header = view.getByRole('button', { name: 'Favorites' });
  const indicator = header.lastElementChild;
  const adjacent = view.getByText('Adjacent section');

  for (let attempt = 0; attempt < 2; attempt++) {
    fireEvent.click(header);
    await waitFor(() => expect(pending.length).toBe(attempt + 1));
    expect(header.isConnected).toBe(true);
    expect(header.lastElementChild).toBe(indicator);
    expect(adjacent.isConnected).toBe(true);
    expect(view.queryByText('Outer loading')).toBeNull();
    pending[attempt]('Favorite row');
    await waitFor(() =>
      expect(view.queryByText('Favorite row')).not.toBeNull()
    );
    fireEvent.click(header);
    await waitFor(() => expect(view.queryByText('Favorite row')).toBeNull());
  }
});
