import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createPriorityCollapseController } from '../components/PriorityCollapseOverflowSensor';
import { SplitToolbar } from '../components/SplitToolbar';

const panel = vi.hoisted(() => ({
  layoutRefs: {} as {
    toolbarLeft?: HTMLDivElement;
    toolbarRight?: HTMLDivElement;
  },
}));
vi.mock('../layoutUtils', () => ({ useSplitPanelOrThrow: () => panel }));

afterEach(() => {
  cleanup();
  panel.layoutRefs = {};
  vi.unstubAllGlobals();
});

it('observes toolbar content when navigation mounts and replaces the toolbar', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
  const [visible, setVisible] = createSignal(false);
  const changed = vi.fn();
  render(() => (
    <Show when={visible()}>
      <SplitToolbar
        ref={() => undefined}
        collapseController={createPriorityCollapseController()}
        onContentChange={changed}
      />
    </Show>
  ));

  setVisible(true);
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(false));
  panel.layoutRefs.toolbarLeft!.appendChild(document.createElement('button'));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(true));
  const previous = panel.layoutRefs.toolbarLeft!;
  setVisible(false);
  setVisible(true);
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(false));
  previous.appendChild(document.createElement('button'));
  await Promise.resolve();
  expect(changed).toHaveBeenLastCalledWith(false);
  panel.layoutRefs.toolbarRight!.appendChild(document.createElement('button'));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(true));
  panel.layoutRefs.toolbarRight!.replaceChildren();
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(false));
});
