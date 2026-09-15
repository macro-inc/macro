import { render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createBlockOrchestrator } from './orchestrator';

vi.mock('./block', () => ({
  Block: (props: ParentProps) => props.children,
  ValidNestingCombinations: {},
}));
vi.mock('./constant/allBlocks', () => ({
  blocks: { channel: { component: () => <div>Channel content</div> } },
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
