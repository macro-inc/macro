import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { InboxEntityDetailRouteView } from './InboxEntityDetailRouteView';

const location = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  target: undefined as
    | { blockType: string; blockId: string; params?: Record<string, string> }
    | undefined,
  close: vi.fn(),
}));

vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useParams: () => location.params,
}));
vi.mock('../inbox-view-context', () => ({
  useInboxView: () => ({
    previewTarget: () => location.target,
    previewNavigationRequest: () => 0,
    closePreview: location.close,
  }),
}));
vi.mock('@channel/Channel/ChannelDetail', () => ({
  ChannelDetailTabs: () => null,
  ChannelDetailActions: () => null,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({}),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({}),
}));
vi.mock('@components/app/PreviewPanel', () => ({
  PreviewPanel: () => <div data-testid="block-preview" />,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Root: (props: { children: JSX.Element }) => <>{props.children}</>,
    Toggle: () => null,
  },
}));
vi.mock('@app/components/entity-detail/EntityDetail', () => ({
  EntityDetail: (props: {
    target: { type: string; id: string; target?: unknown };
    children?: (context: unknown) => JSX.Element;
  }) => (
    <div data-testid="entity-detail">
      <output data-testid="entity-target">
        {JSON.stringify(props.target)}
      </output>
      {props.children?.(
        props.target.type === 'channel'
          ? {
              type: 'channel',
              channelId: props.target.id,
              name: () => 'Team Channel',
            }
          : {
              type: 'document',
              documentMetadata: { documentName: 'Project File' },
            }
      )}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  location.params = {};
  location.target = undefined;
  location.close.mockClear();
});

it('renders a targeted channel through EntityDetail with registered Home breadcrumbs', async () => {
  location.params = { channelId: 'channel-1' };
  location.target = {
    blockType: 'channel',
    blockId: 'channel-1',
    params: { channel_message_id: 'message-1', channel_thread_id: 'thread-1' },
  };
  render(() => <InboxEntityDetailRouteView />);

  expect(
    JSON.parse(screen.getByTestId('entity-target').textContent ?? '')
  ).toEqual({
    type: 'channel',
    id: 'channel-1',
    target: { messageId: 'message-1', threadId: 'thread-1' },
  });
  expect(screen.queryByTestId('block-preview')).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Home' }));
  expect(location.close).toHaveBeenCalledOnce();
  expect(screen.getByText('Team Channel')).toBeTruthy();
});

it('renders an untargeted document through EntityDetail', async () => {
  location.params = { documentType: 'task', documentId: 'task-1' };
  location.target = { blockType: 'md', blockId: 'task-1' };
  render(() => <InboxEntityDetailRouteView />);

  expect(
    JSON.parse(screen.getByTestId('entity-target').textContent ?? '')
  ).toEqual({
    type: 'document',
    id: 'task-1',
    fileType: 'md',
    subType: { type: 'task' },
  });
  expect(await screen.findByText('Project File')).toBeTruthy();
  expect(screen.queryByTestId('block-preview')).toBeNull();
});

it.each([
  ['md', { comment_id: 'comment-1' }],
  ['pdf', { pdf_ann_id: 'comment-1' }],
  ['spreadsheet', undefined],
  ['unknown', undefined],
] as const)(
  'keeps unsupported %s locations in the block preview',
  (type, params) => {
    location.params = { documentType: type, documentId: 'document-1' };
    location.target = {
      blockType: type,
      blockId: 'document-1',
      ...(params ? { params } : {}),
    };
    render(() => <InboxEntityDetailRouteView />);

    expect(screen.getByTestId('block-preview')).toBeTruthy();
    expect(screen.queryByTestId('entity-detail')).toBeNull();
  }
);
