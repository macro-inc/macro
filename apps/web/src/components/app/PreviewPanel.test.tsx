import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewPanel, type PreviewPanelProps } from './PreviewPanel';
import type { PreviewBlockTarget } from './previewTarget';

const mocks = vi.hoisted(() => ({
  goToLocationFromParams: vi.fn(),
  goToLatest: vi.fn(),
  mounts: vi.fn(),
  unmounts: vi.fn(),
}));

vi.mock('@core/hotkey/hotkeys', () => ({
  useHotkeyDOMScope: () => [() => {}, {}],
}));
vi.mock('./split-layout/components/PriorityCollapseOverflowSensor', () => ({
  createPriorityCollapseController: () => ({
    setRow: () => {},
    collapser: {},
  }),
  PriorityCollapseOverflowSensor: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(initial: PreviewBlockTarget) {
  const [target, setTarget] = createSignal(initial);
  const createBlockInstance = vi.fn((type: string, id: string) => ({
    type,
    id,
    element: () => {
      onMount(mocks.mounts);
      onCleanup(mocks.unmounts);
      return (
        <div>
          <span data-testid="block">{id}</span>
          <input aria-label="Message draft" />
        </div>
      );
    },
  }));
  const getBlockHandle = vi.fn(async () => ({
    goToLocationFromParams: mocks.goToLocationFromParams,
    goToLatest: mocks.goToLatest,
  }));
  const orchestrator = {
    isBlockMounted: () => false,
    createBlockInstance,
    getBlockHandle,
  } as unknown as PreviewPanelProps['orchestrator'];
  const onFocusOut = vi.fn();
  const view = render(() => (
    <PreviewPanel
      target={target()}
      orchestrator={orchestrator}
      splitPanelContext={{} as PreviewPanelProps['splitPanelContext']}
      onFocusOut={onFocusOut}
    />
  ));
  return {
    ...view,
    setTarget,
    createBlockInstance,
    getBlockHandle,
    onFocusOut,
  };
}

const channel = (
  id: string,
  params?: Record<string, string>
): PreviewBlockTarget => ({
  blockType: 'channel',
  blockId: id,
  aliasContext: undefined,
  params,
});

describe('preview block navigation', () => {
  it('does not relocate or remount when the same target arrives as a fresh object', async () => {
    const view = setup(channel('channel-1', { channel_message_id: 'm-1' }));
    await flush();
    const draft = view.getByLabelText('Message draft');
    fireEvent.input(draft, { target: { value: 'Unsent draft' } });
    expect(view.getBlockHandle).toHaveBeenCalledTimes(1);
    expect(mocks.goToLocationFromParams).toHaveBeenCalledTimes(1);

    // Hosts recompute targets from cache revisions unrelated to this block.
    view.setTarget(channel('channel-1', { channel_message_id: 'm-1' }));
    view.setTarget(channel('channel-1', { channel_message_id: 'm-1' }));
    await flush();

    expect(view.getBlockHandle).toHaveBeenCalledTimes(1);
    expect(view.createBlockInstance).toHaveBeenCalledTimes(1);
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
    expect(mocks.unmounts).not.toHaveBeenCalled();
    expect(view.getByLabelText('Message draft')).toBe(draft);
    expect((draft as HTMLInputElement).value).toBe('Unsent draft');
  });

  it('preserves focus ownership after interacting with a refreshed preview', () => {
    const view = setup(channel('channel-1'));
    const draft = view.getByLabelText('Message draft');
    fireEvent.pointerDown(draft);
    view.setTarget(channel('channel-1'));
    fireEvent.focusIn(draft);
    expect(view.onFocusOut).not.toHaveBeenCalled();
  });

  it('lands untargeted channels on their latest message', async () => {
    setup(channel('channel-1'));
    await flush();
    expect(mocks.goToLatest).toHaveBeenCalledTimes(1);
    expect(mocks.goToLocationFromParams).not.toHaveBeenCalled();
  });

  it('creates a new block when selecting another channel', async () => {
    const view = setup(channel('channel-1'));
    view.setTarget(channel('channel-2'));
    await flush();
    expect(view.createBlockInstance).toHaveBeenCalledTimes(2);
    expect(mocks.goToLatest).toHaveBeenCalledTimes(2);
    expect(view.getByTestId('block').textContent).toBe('channel-2');
  });

  it('relocates within the same block without remounting it', async () => {
    const view = setup(
      channel('channel-1', {
        channel_message_id: 't-1',
        channel_thread_id: 't-1',
      })
    );
    view.setTarget(
      channel('channel-1', {
        channel_message_id: 't-2',
        channel_thread_id: 't-2',
      })
    );
    await flush();
    expect(mocks.goToLocationFromParams).toHaveBeenCalledTimes(2);
    expect(mocks.goToLocationFromParams).toHaveBeenLastCalledWith({
      channel_message_id: 't-2',
      channel_thread_id: 't-2',
    });
    expect(view.createBlockInstance).toHaveBeenCalledTimes(1);
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
  });
});
