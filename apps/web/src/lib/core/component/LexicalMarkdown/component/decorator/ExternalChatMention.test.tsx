import { ThrownResultError } from '@core/util/result';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentMention } from './DocumentMention';

type DetailRead = {
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  dataUpdatedAt: number;
  data?: { name: string };
};
const mocks = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  detail: {
    isSuccess: false,
    isError: false,
    error: null,
    dataUpdatedAt: 0,
  } as DetailRead,
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|me@example.test',
}));
vi.mock('@app/features/external-chat/queries/production-api', () => ({
  externalChatApi: {},
}));
vi.mock('@queries/external-chats', () => ({
  useExternalChatDetailQuery: () => mocks.detail,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

afterEach(() => {
  cleanup();
  mocks.openWithSplit.mockClear();
  mocks.detail = {
    isSuccess: false,
    isError: false,
    error: null,
    dataUpdatedAt: 0,
  };
});

it('shows an external chat mention by name and opens it inside External', () => {
  render(() => (
    <DocumentMention
      key="node-1"
      documentId="01a16445-9fdc-7bb1-80b4-8935a1243c98"
      documentName="Design Crit"
      blockName="external_chat"
      theme={{}}
    />
  ));
  fireEvent.click(screen.getByRole('link', { name: /Design Crit/ }));
  expect(mocks.openWithSplit).toHaveBeenCalledWith(
    {
      type: 'component',
      id: 'external',
      entryMetadata: {
        route: {
          matches: [
            { id: 'app', params: {} },
            { id: 'view-external', params: {} },
            {
              id: 'external-chat',
              params: { chatId: '01a16445-9fdc-7bb1-80b4-8935a1243c98' },
            },
          ],
        },
      },
    },
    { preferNewSplit: true }
  );
});

it('shows a chat the viewer cannot read as unavailable, not as a link', () => {
  mocks.detail = {
    isSuccess: false,
    isError: true,
    error: new ThrownResultError([
      { code: 'UNAUTHORIZED', message: 'Unauthorized' },
    ]),
    dataUpdatedAt: 0,
  };
  render(() => (
    <DocumentMention
      key="node-1"
      documentId="01a16445-9fdc-7bb1-80b4-8935a1243c98"
      documentName="Design Crit"
      blockName="external_chat"
      theme={{}}
    />
  ));
  expect(screen.getByText('No Access')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByText('Design Crit')).toBeNull();
});
