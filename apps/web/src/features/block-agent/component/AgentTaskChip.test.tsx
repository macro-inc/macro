/** @vitest-environment jsdom */
import type { PreviewItem } from '@queries/preview';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentTaskChip } from './AgentTaskChip';

const { openWithSplit, preview } = vi.hoisted(() => {
  // Imports reach the connection gateway, which dials on load.
  class FakeWebSocket {
    url: string;
    readyState = 1;
    constructor(url: string) {
      this.url = url;
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
    send() {}
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);
  return {
    openWithSplit: vi.fn(),
    preview: { current: undefined as PreviewItem | undefined },
  };
});

vi.mock('@queries/preview', () => ({
  useItemPreview: () => [() => preview.current],
  isAccessiblePreviewItem: (item: PreviewItem) =>
    !item.loading && item.access === 'access',
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit }),
}));
vi.mock('@core/util/useSplitNavigationHandler', () => ({
  useSplitNavigationHandler: (onClick: (event: MouseEvent) => void) => ({
    onClick,
  }),
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: import('solid-js').JSX.Element }) =>
    props.trigger,
}));
vi.mock('@core/component/DocumentPreview', () => ({
  PopupPreview: () => null,
}));

const taskId = '0199c0a8-7d3e-7c1a-9b5e-3f2a1c4d5e6f';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('shows the task title and opens the task in a new split', () => {
  preview.current = {
    access: 'access',
    loading: false,
    id: taskId,
    type: 'document',
    rawName: 'Show the linked task in the session header',
    name: 'Show the linked task in the session header',
    fileType: 'md',
    subType: { type: 'task', is_completed: false },
  };
  render(() => <AgentTaskChip taskId={taskId} />);

  const chip = screen.getByRole('button');
  expect(chip.textContent).toBe('Show the linked task in the session header');
  fireEvent.click(chip);
  expect(openWithSplit).toHaveBeenCalledWith(
    { type: 'task', id: taskId },
    { preferNewSplit: true }
  );
});

it('reads "Task" for a task the viewer cannot see and still opens it', () => {
  preview.current = {
    access: 'no_access',
    loading: false,
    id: taskId,
    type: 'document',
  };
  render(() => <AgentTaskChip taskId={taskId} />);

  const chip = screen.getByRole('button');
  expect(chip.textContent).toBe('Task');
  fireEvent.click(chip);
  expect(openWithSplit).toHaveBeenCalledWith(
    { type: 'task', id: taskId },
    { preferNewSplit: true }
  );
});
