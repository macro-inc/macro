import type { CallBlockProps } from '@block-call/constants';
import { cleanup, render } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import { CallBlockAdapter } from './CallBlockAdapter';

const state = vi.hoisted(() => ({
  search: {} as { transcriptId: string; seek: string },
  navigate: (_params: CallBlockProps) => {},
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  createSearchParams: () => [state.search],
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
  }) => <output>{JSON.stringify(props.transcriptTarget)}</output>,
}));
afterEach(cleanup);

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
