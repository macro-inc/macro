import { render } from '@solidjs/testing-library';
import { createRoot, createSignal, type ParentProps } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createBlockOrchestrator } from './orchestrator';

vi.mock('./block', () => ({
  Block: (props: ParentProps) => props.children,
  ValidNestingCombinations: {},
}));
vi.mock('./constant/allBlocks', () => ({
  resolveBlockAlias: (type: string) => type,
  blocks: {
    channel: { component: () => <div>Channel content</div> },
  },
}));
vi.mock('./internal/BlockLoader', () => ({ BlockLoader: () => null }));
vi.mock('./internal/BlockEffectRunner', () => ({
  BlockEffectRunner: () => null,
}));
vi.mock('./component/LoadingBlock', () => ({ LoadingBlock: () => null }));

it('keeps one live mount and preserves its handle when a duplicate unmounts', async () => {
  const orchestrator = createBlockOrchestrator();
  const first = orchestrator.createBlockInstance('channel', 'channel-1');
  const firstView = render(first.element);
  const navigate = vi.fn();
  first.handle.registerMethod('goToLocationFromParams', navigate);

  const duplicate = orchestrator.createBlockInstance('channel', 'channel-1');
  const duplicateView = render(duplicate.element);
  expect(duplicateView.container.textContent).toBe('Content already open.');
  expect(firstView.container.textContent).toBe('Channel content');
  expect(orchestrator.isBlockMounted('channel', 'channel-1')).toBe(true);

  duplicateView.unmount();
  const handle = await orchestrator.getBlockHandle('channel-1', 'channel');
  await handle?.goToLocationFromParams({ message: 'message-1' });
  expect(navigate).toHaveBeenCalledOnce();

  firstView.unmount();
  expect(orchestrator.isBlockMounted('channel', 'channel-1')).toBe(false);
  const reopened = orchestrator.createBlockInstance('channel', 'channel-1');
  const reopenedView = render(reopened.element);
  expect(reopenedView.container.textContent).toBe('Channel content');
  reopenedView.unmount();
});

it('exposes a handle for content mounted outside a block container until its owner disposes', async () => {
  const orchestrator = createBlockOrchestrator();
  const navigate = vi.fn();
  const dispose = createRoot((dispose) => {
    const handle = orchestrator.registerBlockHandle('channel', 'channel-1');
    handle?.registerMethod('goToLocationFromParams', navigate);
    expect(
      orchestrator.registerBlockHandle('channel', 'channel-1')
    ).toBeUndefined();
    return dispose;
  });

  const handle = await orchestrator.getBlockHandle('channel-1', 'channel');
  await handle?.goToLocationFromParams({ message: 'message-1' });
  expect(navigate).toHaveBeenCalledWith({ message: 'message-1' });

  dispose();
  const mounted = orchestrator.createBlockInstance('channel', 'channel-1');
  const view = render(mounted.element);
  expect(view.container.textContent).toBe('Channel content');
  expect(
    orchestrator.registerBlockHandle('channel', 'channel-1')
  ).toBeUndefined();
  view.unmount();
});

function scopedOrchestrator() {
  const orchestrator = createBlockOrchestrator();
  const [scope, setScope] = createSignal<string | undefined>('tab-a');
  orchestrator.setBlockScope(scope);
  return { orchestrator, setScope };
}

it('mounts one block per scope, each reached through its own handle', async () => {
  const { orchestrator, setScope } = scopedOrchestrator();
  const first = orchestrator.createBlockInstance('channel', 'channel-1');
  const firstView = render(first.element);
  const firstNavigate = vi.fn();
  first.handle.registerMethod('goToLocationFromParams', firstNavigate);

  setScope('tab-b');
  const second = orchestrator.createBlockInstance('channel', 'channel-1');
  const secondView = render(second.element);
  const secondNavigate = vi.fn();
  second.handle.registerMethod('goToLocationFromParams', secondNavigate);
  expect(secondView.container.textContent).toBe('Channel content');
  expect(firstView.container.textContent).toBe('Channel content');

  const live = await orchestrator.getBlockHandle('channel-1', 'channel');
  await live?.goToLocationFromParams({ message: 'message-1' });
  expect(secondNavigate).toHaveBeenCalledOnce();
  expect(firstNavigate).not.toHaveBeenCalled();

  // Closing one scope's mount leaves the other registered.
  secondView.unmount();
  setScope('tab-a');
  expect(orchestrator.isBlockMounted('channel', 'channel-1')).toBe(true);
  const remaining = await orchestrator.getBlockHandle('channel-1', 'channel');
  await remaining?.goToLocationFromParams({ message: 'message-2' });
  expect(firstNavigate).toHaveBeenCalledWith({ message: 'message-2' });
  firstView.unmount();
});

it('waits for the scope to mount its own block instead of reaching another scope', async () => {
  const { orchestrator, setScope } = scopedOrchestrator();
  const parked = orchestrator.createBlockInstance('channel', 'channel-1');
  const parkedView = render(parked.element);
  const parkedNavigate = vi.fn();
  parked.handle.registerMethod('goToLocationFromParams', parkedNavigate);

  setScope('tab-b');
  const pending = orchestrator.getBlockHandle('channel-1', 'channel');
  const live = orchestrator.createBlockInstance('channel', 'channel-1');
  const liveView = render(live.element);
  const liveNavigate = vi.fn();
  live.handle.registerMethod('goToLatest', liveNavigate);

  await (await pending)?.goToLatest();
  expect(liveNavigate).toHaveBeenCalledOnce();
  expect(parkedNavigate).not.toHaveBeenCalled();
  liveView.unmount();
  parkedView.unmount();
});

it('re-keys a block whose tab went to the background before its id resolved', async () => {
  const { orchestrator, setScope } = scopedOrchestrator();
  const pending = orchestrator.createBlockInstance('channel', 'placeholder');
  const view = render(pending.element);

  setScope('tab-b');
  orchestrator.rekeyBlockInstance('channel', 'placeholder', 'channel-1');
  expect(orchestrator.isBlockMounted('channel', 'channel-1')).toBe(false);

  setScope('tab-a');
  expect(orchestrator.isBlockMounted('channel', 'channel-1')).toBe(true);
  view.unmount();
  expect(orchestrator.isBlockMounted('channel', 'channel-1')).toBe(false);
});
