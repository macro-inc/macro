import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PreviewPanel,
  type PreviewPanelProps,
  type PreviewPanelSelection,
  useMaybePreviewPanel,
} from './PreviewPanel';

const mocks = vi.hoisted(() => ({
  navigateChannel: vi.fn(),
  navigateCalendar: vi.fn(),
  mounts: vi.fn(),
  unmounts: vi.fn(),
}));

// Exercise the real preview without loading unrelated blocks or service clients.
vi.mock('@app/features/next-soup/utils', () => ({
  getChannelEntityTarget: () => ({ kind: 'latest' }),
  navigateChannelEntityToTarget: mocks.navigateChannel,
  navigateCalendarPreviewToTarget: mocks.navigateCalendar,
  calendarViewTargetForEntity: vi.fn(),
  reminderSplitTarget: vi.fn(),
}));
vi.mock('@block-calendar/types', () => ({ CALENDAR_BLOCK_ID: 'calendar' }));
vi.mock('@block-channel/utils/link', () => ({ getChannelParams: vi.fn() }));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToResolvedBlockName: (type: string) => type,
}));
vi.mock('@core/constant/featureFlags', () => ({
  USE_MACRO_PR_SUMMARY_BLOCK: false,
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

function setup(initial: PreviewPanelSelection) {
  const [entity, setEntity] = createSignal(initial);
  let preview: ReturnType<typeof useMaybePreviewPanel>;
  const element = () => {
    preview = useMaybePreviewPanel();
    onMount(mocks.mounts);
    onCleanup(mocks.unmounts);
    return (
      <div>
        <span data-testid="selection">{preview?.previewEntity().id}</span>
        <input aria-label="Message draft" />
      </div>
    );
  };
  const createBlockInstance = vi.fn((type: string, id: string) => ({
    type,
    id,
    element,
  }));
  const orchestrator = {
    isBlockMounted: () => false,
    createBlockInstance,
  } as unknown as PreviewPanelProps['orchestrator'];
  const onFocusOut = vi.fn();
  const view = render(() => (
    <PreviewPanel
      selectedEntity={entity()}
      orchestrator={orchestrator}
      splitPanelContext={{} as PreviewPanelProps['splitPanelContext']}
      onFocusOut={onFocusOut}
    />
  ));
  return {
    ...view,
    setEntity,
    createBlockInstance,
    onFocusOut,
    previewEntity: () => preview?.previewEntity(),
  };
}

const channelSelections = [
  { type: 'channel', id: 'channel-1' },
  {
    type: 'channel_message',
    id: 'message-1',
    channelId: 'channel-1',
    messageId: 'message-1',
  },
  {
    type: 'channel_thread',
    id: 'thread-1',
    channelId: 'channel-1',
    messageId: 'thread-1',
    threadId: 'thread-1',
  },
] satisfies PreviewPanelSelection[];

describe('channel preview navigation', () => {
  it.each(channelSelections)(
    'does not navigate or remount a $type on cache object replacement',
    (selection) => {
      const view = setup(selection);
      const draft = view.getByLabelText('Message draft');
      fireEvent.input(draft, { target: { value: 'Unsent draft' } });
      expect(mocks.navigateChannel).toHaveBeenCalledTimes(1);

      // GraphQL local projections publish fresh objects on cache revisions,
      // including revisions unrelated to this conversation.
      view.setEntity({ ...selection, notifications: () => [] });
      const refreshed = { ...selection, notifications: () => [] };
      view.setEntity(refreshed);

      expect(view.previewEntity()).toBe(refreshed);
      expect(mocks.navigateChannel).toHaveBeenCalledTimes(1);
      expect(view.createBlockInstance).toHaveBeenCalledTimes(1);
      expect(mocks.mounts).toHaveBeenCalledTimes(1);
      expect(mocks.unmounts).not.toHaveBeenCalled();
      expect(view.getByLabelText('Message draft')).toBe(draft);
      expect((draft as HTMLInputElement).value).toBe('Unsent draft');
    }
  );

  it('preserves focus ownership after interacting with a refreshed preview', () => {
    const view = setup(channelSelections[0]);
    const draft = view.getByLabelText('Message draft');
    fireEvent.pointerDown(draft);
    view.setEntity({ ...channelSelections[0] });
    fireEvent.focusIn(draft);
    expect(view.onFocusOut).not.toHaveBeenCalled();
  });

  it('navigates when selecting another channel', () => {
    const view = setup(channelSelections[0]);
    view.setEntity({ type: 'channel', id: 'channel-2' });
    expect(mocks.navigateChannel).toHaveBeenCalledTimes(2);
    expect(view.createBlockInstance).toHaveBeenCalledTimes(2);
    expect(view.getByTestId('selection').textContent).toBe('channel-2');
  });

  it('retargets different threads without remounting their shared channel', () => {
    const view = setup(channelSelections[2]);
    view.setEntity({
      ...channelSelections[2],
      id: 'thread-2',
      messageId: 'thread-2',
      threadId: 'thread-2',
    });
    expect(mocks.navigateChannel).toHaveBeenCalledTimes(2);
    expect(view.createBlockInstance).toHaveBeenCalledTimes(1);
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('selection').textContent).toBe('thread-2');
  });

  it('honors explicit target changes for the same channel, including store updates', () => {
    const [entity, setEntity] = createStore({
      ...channelSelections[0],
      target: { messageId: 'reply-1', threadId: 'thread-1' },
    });
    setup(entity);
    setEntity(
      reconcile({
        ...channelSelections[0],
        target: { messageId: 'reply-1', threadId: 'thread-1' },
      })
    );
    expect(mocks.navigateChannel).toHaveBeenCalledTimes(1);
    setEntity('target', 'messageId', 'reply-2');
    expect(mocks.navigateChannel).toHaveBeenCalledTimes(2);
    setEntity('target', 'threadId', 'thread-2');
    expect(mocks.navigateChannel).toHaveBeenCalledTimes(3);
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
  });

  it('preserves calendar occurrence navigation within the singleton block', () => {
    const event = {
      type: 'calendar_event',
      id: 'event-1',
      occurrenceKey: 'occurrence-1',
      time: {
        kind: 'allDay',
        startDate: '2026-09-17',
        endDate: '2026-09-18',
      },
    } satisfies PreviewPanelSelection;
    const view = setup(event);
    view.setEntity({ ...event, occurrenceKey: 'occurrence-2' });
    expect(mocks.navigateCalendar).toHaveBeenCalledTimes(2);
    expect(view.createBlockInstance).toHaveBeenCalledTimes(1);
    expect(mocks.mounts).toHaveBeenCalledTimes(1);
  });
});
