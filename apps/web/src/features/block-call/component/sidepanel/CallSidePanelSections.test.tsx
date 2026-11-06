// @vitest-environment jsdom
import type { CallRecord } from '@service-call/client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CallSidePanelSections } from './CallSidePanelSections';

const mocks = vi.hoisted(() => ({
  setShare: vi.fn(async () => ({ shared: true })),
  liveShare: vi.fn(),
  userId: 'viewer',
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => mocks.userId }));
vi.mock('@channel/Call/CallContext', () => ({
  useCallContextOptional: () => undefined,
}));
vi.mock('@queries/call/call', () => ({
  isCallSharedWithTeam: (record: CallRecord) => record.shareWithTeam,
  useSetCallRecordTeamShareMutation: () => ({
    mutateAsync: mocks.setShare,
    isPending: false,
  }),
  useToggleShareWithTeamMutation: () => ({
    mutateAsync: mocks.liveShare,
    isPending: false,
  }),
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Footer: (props: { children: JSX.Element }) => props.children,
    Section: (props: { children: JSX.Element }) => props.children,
  },
}));
vi.mock('@app/features/activity/views/entity-activity-section', () => ({
  EntityActivitySectionConditional: () => null,
}));
vi.mock('@app/features/property/side-panel/properties', () => ({
  EntityPropertiesSection: () => null,
}));
vi.mock('@entity/owner/owner-display', () => ({ OwnerLabel: () => null }));
vi.mock('@queries/storage/attachment-references', () => ({
  useAttachmentReferencesQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@core/component/References', () => ({ References: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const RECORD: CallRecord = {
  callId: 'call',
  createdBy: 'viewer',
  channelId: 'channel',
  startedAt: '2026-01-01T00:00:00Z',
  isActive: false,
  shareWithTeam: false,
  participants: [],
  guests: [],
  transcript: [],
  discussion: { kind: 'call_chat', call_id: 'call' },
};

it('updates archived team access through the canonical mutation', async () => {
  render(() => <CallSidePanelSections callId="call" record={RECORD} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Share with team' }));
  await waitFor(() =>
    expect(mocks.setShare).toHaveBeenCalledWith({
      callId: 'call',
      shared: true,
    })
  );
  expect(mocks.liveShare).not.toHaveBeenCalled();
});

it('keeps archived sharing read-only for a non-owner', () => {
  render(() => (
    <CallSidePanelSections
      callId="call"
      record={{ ...RECORD, createdBy: 'owner' }}
    />
  ));
  expect(
    screen.getByRole('switch', { name: 'Share with team' })
  ).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('switch', { name: 'Share with team' }));
  expect(mocks.setShare).not.toHaveBeenCalled();
});
