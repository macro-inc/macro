import { useItemPreviewData } from '@core/component/ItemPreview';
import type {
  AccessiblePreviewItem,
  PreviewItem,
} from '@queries/preview/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentMention } from './DocumentMention';

const mocks = vi.hoisted(() => ({
  item: undefined as PreviewItem | undefined,
  touch: false,
  useItemPreview: vi.fn(),
  openDocument: vi.fn(),
  openCalendarEventSplit: vi.fn(),
}));
vi.mock('@queries/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useItemPreview: mocks.useItemPreview,
}));
vi.mock('@app/lib/analytics/posthog', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@core/component/EntityIcon', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  EntityIcon: () => null,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('../core/BlockLink', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openDocument: mocks.openDocument,
}));
vi.mock('@app/features/calendar-view/open-calendar-event', () => ({
  openCalendarEventSplit: mocks.openCalendarEventSplit,
}));
// Keep the real hover trigger; preview-body actions have their own integration tests.
vi.mock('@core/component/DocumentPreview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  PopupPreview: () => null,
}));
vi.mock('@core/component/DocumentPreviewSheet', () => ({
  DocumentPreviewSheet: () => null,
}));

beforeEach(() => {
  mocks.touch = false;
  mocks.item = {
    id: 'thread-1',
    type: 'email',
    access: 'access',
    loading: false,
    name: 'Thread subject',
    rawName: 'Thread subject',
  };
  mocks.openDocument.mockReset();
  mocks.openCalendarEventSplit.mockReset();
  mocks.useItemPreview.mockReset();
  mocks.useItemPreview.mockImplementation(() => [
    () => mocks.item,
    { documentProperties: () => undefined },
  ]);
});

afterEach(cleanup);

it('uses reactive host metadata without constructing a live preview query', () => {
  createRoot((dispose) => {
    const [preview, setPreview] = createSignal<AccessiblePreviewItem>({
      id: 'thread-1',
      type: 'email',
      access: 'access',
      loading: false,
      name: 'First subject',
      rawName: 'First subject',
    });
    const data = useItemPreviewData(
      () => ({ id: preview().id, type: 'email' }),
      preview
    );

    expect(data.name()).toBe('First subject');
    expect(data.targetType()).toBe('email');
    expect(data.documentProperties()).toBeUndefined();
    expect(mocks.useItemPreview).not.toHaveBeenCalled();

    setPreview({
      id: 'thread-2',
      type: 'email',
      access: 'access',
      loading: false,
      name: 'Updated subject',
      rawName: 'Updated subject',
    });

    expect(data.item().id).toBe('thread-2');
    expect(data.name()).toBe('Updated subject');
    expect(mocks.useItemPreview).not.toHaveBeenCalled();
    dispose();
  });
});

it('updates a supplied mention and its open target without a live query', () => {
  const [preview, setPreview] = createSignal<AccessiblePreviewItem>({
    id: 'thread-1',
    type: 'email',
    access: 'access',
    loading: false,
    name: 'First subject',
    rawName: 'First subject',
  });
  mocks.openDocument.mockReturnValue({ status: 'reused' });
  const onOpened = vi.fn();
  render(() => (
    <DocumentMention
      key="mention-1"
      documentId={preview().id}
      documentName={preview().name}
      blockName="email"
      theme={{}}
      inlinePreview={preview}
      onOpened={onOpened}
    />
  ));

  expect(screen.getByRole('link', { name: 'First subject' })).toBeTruthy();
  expect(mocks.useItemPreview).not.toHaveBeenCalled();

  setPreview({
    id: 'thread-2',
    type: 'email',
    access: 'access',
    loading: false,
    name: 'Updated subject',
    rawName: 'Updated subject',
  });
  expect(screen.queryByRole('link', { name: 'First subject' })).toBeNull();
  screen.getByRole('link', { name: 'Updated subject' }).click();

  expect(mocks.openDocument).toHaveBeenCalledExactlyOnceWith(
    'email',
    'thread-2',
    undefined,
    true
  );
  expect(onOpened).toHaveBeenCalledOnce();
  expect(mocks.useItemPreview).not.toHaveBeenCalled();
});

it.each([false, true])(
  'gives a standalone mention one working keyboard target (touch: %s)',
  (touch) => {
    mocks.touch = touch;
    mocks.openDocument.mockReturnValue({ status: 'reused' });
    const onOpened = vi.fn();
    render(() => (
      <DocumentMention
        key="mention-1"
        documentId="thread-1"
        documentName="Thread subject"
        blockName="email"
        theme={{}}
        onOpened={onOpened}
      />
    ));

    const link = screen.getByRole('link', { name: 'Thread subject' });
    expect(mocks.useItemPreview).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(link.tabIndex).toBe(0);
    expect(link.getAttribute('aria-disabled')).not.toBe('true');
    link.focus();
    expect(document.activeElement).toBe(link);

    fireEvent.keyDown(link, { key: 'Enter', shiftKey: true });

    expect(mocks.openDocument).toHaveBeenCalledExactlyOnceWith(
      'email',
      'thread-1',
      undefined,
      !touch
    );
    expect(onOpened).toHaveBeenCalledOnce();
  }
);

it.each(['opened', 'reused', 'navigating', 'unavailable'])(
  'only dismisses the host after a successful open (%s)',
  (status) => {
    mocks.openDocument.mockReturnValue({ status });
    const onOpened = vi.fn();
    render(() => (
      <DocumentMention
        key="mention-1"
        documentId="thread-1"
        documentName="Thread subject"
        blockName="email"
        theme={{}}
        onOpened={onOpened}
      />
    ));

    fireEvent.click(screen.getByText('Thread subject'));

    expect(mocks.openDocument).toHaveBeenCalledOnce();
    expect(onOpened).toHaveBeenCalledTimes(status === 'unavailable' ? 0 : 1);
  }
);

it.each([false, true])(
  'opens when assistive technology activates the link itself (touch: %s)',
  (touch) => {
    mocks.touch = touch;
    mocks.openDocument.mockReturnValue({ status: 'opened' });
    const onOpened = vi.fn();
    render(() => (
      <DocumentMention
        key="mention-1"
        documentId="thread-1"
        documentName="Thread subject"
        blockName="email"
        theme={{}}
        onOpened={onOpened}
      />
    ));

    screen.getByRole('link', { name: 'Thread subject' }).click();

    expect(mocks.openDocument).toHaveBeenCalledOnce();
    expect(onOpened).toHaveBeenCalledOnce();
  }
);

it('does not open a loading mention or dismiss its host from Enter', () => {
  mocks.item = { id: 'thread-1', type: 'email', loading: true };
  const onOpened = vi.fn();
  render(() => (
    <DocumentMention
      key="mention-1"
      documentId="thread-1"
      documentName="Thread subject"
      blockName="email"
      theme={{}}
      onOpened={onOpened}
    />
  ));

  fireEvent.keyDown(screen.getByRole('link', { name: 'Thread subject' }), {
    key: 'Enter',
  });

  expect(mocks.openDocument).not.toHaveBeenCalled();
  expect(onOpened).not.toHaveBeenCalled();
});

it.each([false, true])(
  'waits for the calendar open result before dismissing its host (%s)',
  async (opened) => {
    mocks.item = {
      id: 'calendar-1',
      type: 'calendar_event',
      access: 'does_not_exist',
      loading: false,
    };
    let finishOpen!: (value: boolean) => void;
    const pendingOpen = new Promise<boolean>((resolve) => {
      finishOpen = resolve;
    });
    mocks.openCalendarEventSplit.mockReturnValue(pendingOpen);
    const onOpened = vi.fn();
    render(() => (
      <DocumentMention
        key="mention-1"
        documentId="calendar-1"
        documentName="New calendar event"
        blockName="calendar"
        createdAt={Date.now()}
        theme={{}}
        onOpened={onOpened}
      />
    ));

    fireEvent.keyDown(
      screen.getByRole('link', { name: 'New calendar event' }),
      {
        key: 'Enter',
      }
    );
    expect(mocks.openCalendarEventSplit).toHaveBeenCalledOnce();
    expect(onOpened).not.toHaveBeenCalled();

    finishOpen(opened);
    await pendingOpen;
    expect(onOpened).toHaveBeenCalledTimes(opened ? 1 : 0);
    expect(mocks.openDocument).not.toHaveBeenCalled();
  }
);
