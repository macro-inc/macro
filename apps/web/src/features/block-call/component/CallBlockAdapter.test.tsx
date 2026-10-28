import type { CallBlockProps } from '@block-call/constants';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import { CallBlockAdapter } from './CallBlockAdapter';

const state = vi.hoisted(() => ({
  search: {} as { transcriptId: string; messageId?: string; seek: string },
  setSearch: vi.fn(),
  navigate: (_params: CallBlockProps) => {},
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  createSearchParams: () => [state.search, state.setSearch],
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@core/block', () => ({ useBlockId: () => 'call' }));
vi.mock('@core/orchestrator', () => ({
  createMethodRegistration: (
    _handle: unknown,
    methods: { goToLocationFromParams: typeof state.navigate }
  ) => {
    state.navigate = methods.goToLocationFromParams;
  },
}));
vi.mock('@core/signal/load', () => ({
  blockHandleSignal: { get: () => undefined },
}));
vi.mock('@solidjs/router', () => ({ useSearchParams: () => [{}] }));
vi.mock('@queries/call/call', () => ({
  useCallRecordQuery: () => ({ data: {} }),
}));
vi.mock('@core/component/DocumentBlockContainer', () => ({
  DocumentBlockContainer: (props: { children: unknown }) => props.children,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: { Layout: (props: { children: unknown }) => props.children },
}));
vi.mock('./CallRecording/CallRecordingSplitHeader', () => ({
  CallRecordingSplitHeader: () => null,
}));
vi.mock('./sidepanel/CallSidePanelSections', () => ({
  CallSidePanelSections: () => null,
}));
vi.mock('./CallRecording/CallRecordingBody', () => ({
  CallRecordingBody: (props: {
    transcriptTarget?: { transcriptId: string; gen: number };
    messageTarget?: string;
    messageTargetRequestKey?: string | number;
    onClearMessageTarget?: () => void;
  }) => (
    <>
      <output>{JSON.stringify(props.transcriptTarget)}</output>
      <output
        data-message-target
        data-request-key={props.messageTargetRequestKey}
      >
        {props.messageTarget}
      </output>
      <button onClick={props.onClearMessageTarget}>Clear message target</button>
    </>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('delivers and clears transcript requests in the legacy call body', () => {
  const [search, setSearch] = createStore({
    transcriptId: 'segment',
    seek: 'first',
  });
  state.search = search;
  const view = render(() => <CallBlockAdapter />);
  const target = () =>
    JSON.parse(view.container.querySelector('output')!.textContent!);
  expect(target()).toEqual({ transcriptId: 'segment', gen: 0 });
  setSearch('seek', 'repeat');
  expect(target()).toEqual({ transcriptId: 'segment', gen: 1 });
  setSearch({ transcriptId: 'another', seek: 'next' });
  expect(target().transcriptId).toBe('another');
  expect(target().gen).toBeGreaterThan(1);
  setSearch({ transcriptId: '', seek: '' });
  expect(view.container.querySelector('output')!.textContent).toBe('');
  setSearch({ transcriptId: 'segment', seek: 'reopen' });
  expect(target().transcriptId).toBe('segment');
});

it('preserves an imperative transcript target across Home route cleanup', () => {
  const [search, setSearch] = createStore({
    transcriptId: 'route-segment',
    seek: 'first',
  });
  state.search = search;
  const view = render(() => <CallBlockAdapter />);
  const target = () =>
    JSON.parse(view.container.querySelector('output')!.textContent!);
  state.navigate({ call_transcript_id: 'mention-segment' });
  const mentionTarget = target();
  setSearch({ transcriptId: '', seek: '' });
  expect(target()).toEqual(mentionTarget);
  expect(target().transcriptId).toBe('mention-segment');
  setSearch({ transcriptId: 'new-route-segment', seek: 'next' });
  expect(target().transcriptId).toBe('new-route-segment');
  setSearch({ transcriptId: '', seek: '' });
  expect(view.container.querySelector('output')!.textContent).toBe('');
});

it('delivers updated route message targets and clears them without remounting', () => {
  const [search, setSearch] = createStore({
    transcriptId: '',
    messageId: 'route-message',
    seek: 'first',
  });
  state.search = search;
  const view = render(() => <CallBlockAdapter call_message_id="old-message" />);
  const target = () =>
    view.container.querySelector('[data-message-target]')!.textContent;

  expect(target()).toBe('route-message');
  setSearch({ messageId: 'another-message', seek: 'next' });
  expect(target()).toBe('another-message');
  setSearch({ messageId: '', seek: '' });
  expect(target()).toBe('');
  setSearch({ messageId: 'route-message', seek: 'reopen' });
  expect(target()).toBe('route-message');
});

it('preserves imperative message targets during route cleanup and clears on untargeted navigation', () => {
  const [search, setSearch] = createStore({
    transcriptId: '',
    messageId: 'route-message',
    seek: 'first',
  });
  state.search = search;
  const view = render(() => <CallBlockAdapter />);
  const target = () =>
    view.container.querySelector('[data-message-target]')!.textContent;

  state.navigate({ call_message_id: 'linked-message' });
  setSearch({ messageId: '', seek: '' });
  expect(target()).toBe('linked-message');
  state.navigate({});
  expect(target()).toBe('');
  state.navigate({ call_message_id: 'linked-message' });
  state.navigate({ call_transcript_id: 'segment' });
  expect(target()).toBe('');
  setSearch({ messageId: 'another-message', seek: 'next' });
  expect(target()).toBe('another-message');
  setSearch({ messageId: '', seek: '' });
  expect(target()).toBe('');
});

it('reissues the same message target for repeated route and imperative navigation', () => {
  const [search, setSearch] = createStore({
    transcriptId: '',
    messageId: 'route-message',
    seek: 'first',
  });
  state.search = search;
  const view = render(() => <CallBlockAdapter />);
  const target = view.container.querySelector('[data-message-target]')!;
  const initialRequest = target.getAttribute('data-request-key');

  setSearch('seek', 'repeat');
  expect(target.textContent).toBe('route-message');
  expect(target.getAttribute('data-request-key')).not.toBe(initialRequest);
  const repeatedRequest = target.getAttribute('data-request-key');
  state.navigate({ call_message_id: 'route-message' });
  expect(target.getAttribute('data-request-key')).not.toBe(repeatedRequest);
  const imperativeRequest = target.getAttribute('data-request-key');
  setSearch({ messageId: '', seek: '' });
  expect(target.getAttribute('data-request-key')).toBe(imperativeRequest);
  state.navigate({ call_message_id: 'route-message' });
  expect(target.getAttribute('data-request-key')).not.toBe(imperativeRequest);
  expect(view.container.querySelector('[data-message-target]')).toBe(target);
});

it('clears the route message target when its highlight is released', () => {
  const [search, setSearch] = createStore({
    transcriptId: 'segment',
    messageId: 'route-message',
    seek: 'first',
  });
  state.search = search;
  state.setSearch.mockImplementation((patch) => {
    setSearch({ ...patch, messageId: patch.messageId ?? '' });
  });
  const view = render(() => <CallBlockAdapter />);

  fireEvent.click(view.getByRole('button', { name: 'Clear message target' }));

  expect(state.setSearch).toHaveBeenCalledWith(
    { messageId: undefined },
    { history: 'replace' }
  );
  expect(search.messageId).toBe('');
  expect(search.transcriptId).toBe('segment');
  setSearch('seek', 'next');
  expect(
    view.container.querySelector('[data-message-target]')!.textContent
  ).toBe('');
});
