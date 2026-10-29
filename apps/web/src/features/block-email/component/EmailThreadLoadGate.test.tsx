import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import { createEmailThreadSource } from '@app/features/email-thread/queries/thread-source';
import type { EntityLoadError } from '@core/component/EntityLoadGate';
import type { ThreadQueryData, ThreadQueryResult } from '@queries/email/thread';
import type { ApiThread } from '@service-email/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { batch, createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  EmailThreadLoadGate,
  type EmailThreadLoadGateProps,
} from './EmailThreadLoadGate';

const markers = vi.hoisted(() => ({
  mounts: [] as string[],
  releases: [] as string[],
}));
const localDrafts = vi.hoisted(() => vi.fn<() => LocalDraft[]>(() => []));
vi.mock('@queries/email/local-draft-source', () => ({
  createLocalDraftSource: () => ({ drafts: localDrafts, ready: () => true }),
}));
beforeEach(() => localDrafts.mockReset().mockReturnValue([]));
vi.mock('@notifications', () => ({
  EmailDebouncedReadMarker: (props: { threadId: string; linkId?: string }) => {
    const id = props.threadId;
    onMount(() => markers.mounts.push(id));
    onCleanup(() => markers.releases.push(id));
    return (
      <span data-testid="read-marker">
        {props.threadId}:{props.linkId}
      </span>
    );
  },
}));
vi.mock('@core/mobile/native-network-status', () => ({
  nativeNetworkStatus: () => 'online',
}));
vi.mock('@core/component/AccessErrorViews/NotFound', () => ({
  default: () => <div>Not found</div>,
}));
vi.mock('@core/component/AccessErrorViews/Unauthorized', () => ({
  default: () => <div>Access denied</div>,
}));
vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <div>Loading</div>,
}));
afterEach(cleanup);

it('opens an unqueued local draft after a server 404 without overriding access errors or confirmed deletion', () => {
  const [draft, setDraft] = createSignal<LocalDraft>({
    key: 'local-draft',
    draftId: 'local-draft',
    threadId: 'local-thread',
    accountId: 'owner',
    generation: 'generation',
    revision: 1,
    acknowledgedRevision: 0,
    content: { subject: 'Recovered subject', body_html: btoa('Saved body') },
    attachments: [],
    status: 'dirty',
    updatedAt: Date.now(),
  });
  localDrafts.mockImplementation(() => [draft()]);
  const [error, setError] = createSignal<EntityLoadError>('NOT_FOUND');
  render(() => {
    const source = createEmailThreadSource(() => 'local-thread', {
      transport: 'graphql',
      resolvedThreadId: 'local-thread',
      isError: true,
      isSuccess: false,
      isLoading: false,
      data: undefined,
    } as ThreadQueryResult<ThreadQueryData>);
    return (
      <EmailThreadLoadGate
        result={{ data: source.thread, error, isPending: source.isLoading }}
        isLocalDraft={source.isLocalDraft()}
        threadId="local-thread"
        notificationSource={
          {} as EmailThreadLoadGateProps<ApiThread>['notificationSource']
        }
        onRetry={() => {}}
      >
        <input
          aria-label="Subject"
          value={source.thread()?.messages[0].subject ?? ''}
        />
      </EmailThreadLoadGate>
    );
  });
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'Recovered subject'
  );
  expect(screen.queryByTestId('read-marker')).toBeNull();
  expect(screen.queryByText('Not found')).toBeNull();

  setError('FORBIDDEN');
  expect(screen.queryByRole('textbox')).toBeNull();
  setError('NOT_FOUND');
  expect(screen.getByRole('textbox')).toBeTruthy();

  // Once the server has acknowledged the thread, a later 404 is authoritative.
  setDraft({ ...draft(), serverThreadId: 'server-thread' });
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText('Not found')).toBeTruthy();
  // Editing a previously saved draft also proves a server identity even if
  // its working copy has not separately recorded the server thread ID yet.
  setDraft({
    ...draft(),
    serverThreadId: undefined,
    serverDraftId: 'server-draft',
  });
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('clears the previous thread and read marker when a reused host navigates', () => {
  const [route, setRoute] = createSignal('first');
  const [pending, setPending] = createSignal(false);
  const fixture = (id: string): ThreadQueryData => ({
    thread: {
      db_id: id,
      link_id: `${id}-inbox`,
      access_level: 'owner',
      inbox_visible: true,
      is_read: false,
      messages: [],
      created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-01T10:00:00Z',
    } satisfies ApiThread,
    hasMore: false,
  });
  const [data, setData] = createSignal(fixture('first'));
  const unmounted = vi.fn();
  render(() => {
    const source = createEmailThreadSource(route, {
      get resolvedThreadId() {
        return route();
      },
      get isSuccess() {
        return !pending();
      },
      isError: false,
      get data() {
        if (pending()) throw new Error('pending resource must not be read');
        return data();
      },
    } as ThreadQueryResult<ThreadQueryData>);
    const Composer = () => {
      onCleanup(unmounted);
      return <input aria-label="Draft body" value={source.thread()?.db_id} />;
    };
    return (
      <>
        <div data-testid="title">
          {source.thread()?.db_id ?? 'Loading email'}
        </div>
        <EmailThreadLoadGate
          result={{
            data: source.thread,
            error: () => undefined,
            isPending: pending,
          }}
          notificationSource={
            {} as EmailThreadLoadGateProps<ApiThread>['notificationSource']
          }
          threadId={route()}
          linkId={source.thread()?.link_id}
          onRetry={() => {}}
        >
          <Composer />
        </EmailThreadLoadGate>
      </>
    );
  });
  expect(screen.getByTestId('title').textContent).toBe('first');
  expect(screen.getByTestId('read-marker').textContent).toBe(
    'first:first-inbox'
  );
  // The query may still report the old successful result when props change.
  setRoute('second');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByTestId('read-marker')).toBeNull();
  expect(screen.getByText('Loading')).toBeTruthy();
  setPending(true);
  expect(screen.getByTestId('title').textContent).toBe('Loading email');
  expect(screen.getByText('Loading')).toBeTruthy();
  expect(unmounted).toHaveBeenCalledOnce();
  setData(fixture('second'));
  setPending(false);
  expect(screen.getByTestId('title').textContent).toBe('second');
  expect(screen.getByTestId('read-marker').textContent).toBe(
    'second:second-inbox'
  );
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'second'
  );
});

it('shows loading while identity resolution has not started the thread query', () => {
  const [data, setData] = createSignal<string>();
  const [error, setError] = createSignal<EntityLoadError>();
  render(() => (
    <EmailThreadLoadGate
      result={{ data, error, isPending: () => false }}
      notificationSource={
        {} as EmailThreadLoadGateProps<string>['notificationSource']
      }
      threadId="thread"
      onRetry={() => {}}
    >
      <div>Email content</div>
    </EmailThreadLoadGate>
  ));
  expect(screen.getByText('Loading')).toBeTruthy();
  expect(screen.queryByTestId('read-marker')).toBeNull();
  expect(screen.queryByText(/unexpected error/)).toBeNull();

  setError('LOAD_FAILED');
  expect(screen.getByText('Unable to load this email')).toBeTruthy();
  expect(screen.queryByText('Loading')).toBeNull();

  setError(undefined);
  expect(screen.getByText('Loading')).toBeTruthy();
  setData('thread');
  expect(screen.getByText('Email content')).toBeTruthy();
  expect(screen.getByTestId('read-marker')).toBeTruthy();
});

it('retains the mounted composer during identity revalidation but respects server deletion', () => {
  const [data, setData] = createSignal<string>();
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal<EntityLoadError>();
  const unmounted = vi.fn();
  const Composer = () => {
    onCleanup(unmounted);
    return <input aria-label="Draft body" />;
  };
  render(() => (
    <EmailThreadLoadGate
      result={{ data, error, isPending: pending }}
      // The read marker is mocked; this test exercises the real load gate.
      notificationSource={
        {} as EmailThreadLoadGateProps<string>['notificationSource']
      }
      threadId="local-thread"
      onRetry={() => {}}
    >
      <Composer />
    </EmailThreadLoadGate>
  ));
  expect(screen.queryByRole('textbox')).toBeNull();
  setData('local-thread');
  setPending(false);
  const editor = screen.getByRole('textbox') as HTMLInputElement;
  editor.value = 'Keep unsaved text';
  editor.focus();
  setPending(true);
  expect(screen.getByRole('textbox')).toBe(editor);
  setData('server-thread');
  setPending(false);
  expect(screen.getByRole('textbox')).toBe(editor);
  expect(editor.value).toBe('Keep unsaved text');
  expect(document.activeElement).toBe(editor);
  expect(unmounted).not.toHaveBeenCalled();
  setError('NOT_FOUND');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText('Not found')).toBeTruthy();
  expect(unmounted).toHaveBeenCalledOnce();
});

it('restarts read marking for cached navigation without remounting the body', () => {
  markers.mounts.length = 0;
  markers.releases.length = 0;
  const [id, setId] = createSignal('a');
  const [data, setData] = createSignal<string | undefined>('cached');
  const [pending, setPending] = createSignal(false);
  render(() => (
    <EmailThreadLoadGate
      threadId={id()}
      notificationSource={
        {} as EmailThreadLoadGateProps<string>['notificationSource']
      }
      result={{ data, error: () => undefined, isPending: pending }}
      onRetry={() => {}}
    >
      <div data-testid="body" />
    </EmailThreadLoadGate>
  ));
  const body = screen.getByTestId('body');
  expect(markers.mounts).toEqual(['a']);
  setId('b');
  expect(markers.mounts).toEqual(['a', 'b']);
  expect(markers.releases).toEqual(['a']);
  expect(screen.getByTestId('body')).toBe(body);
  setId('b');
  expect(markers.mounts).toHaveLength(2);
  batch(() => {
    setData(undefined);
    setPending(true);
  });
  expect(markers.releases).toEqual(['a', 'b']);
});
