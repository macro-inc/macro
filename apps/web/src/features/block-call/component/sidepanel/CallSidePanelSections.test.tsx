// @vitest-environment jsdom
import type { CallRecord } from '@service-call/client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CallSidePanelSections } from './CallSidePanelSections';

const mocks = vi.hoisted(() => ({
  setShare: vi.fn(async () => ({ shared: true })),
  liveShare: vi.fn(),
  userId: 'viewer',
  pending: false,
  nameParts: vi.fn(() => ({
    firstName: 'Test',
    lastName: 'Owner',
    fullName: 'Test Owner',
  })),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => mocks.userId }));
vi.mock('@channel/Call/CallContext', () => ({
  useCallContextOptional: () => undefined,
}));
vi.mock('@queries/call/call', () => ({
  isCallSharedWithTeam: (record: CallRecord) => record.shareWithTeam,
  useSetCallRecordTeamShareMutation: () => ({
    mutateAsync: mocks.setShare,
    get isPending() {
      return mocks.pending;
    },
  }),
  useToggleShareWithTeamMutation: () => ({
    mutateAsync: mocks.liveShare,
    get isPending() {
      return mocks.pending;
    },
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
vi.mock('@core/user', () => ({
  getDisplayNameParts: mocks.nameParts,
}));
vi.mock('@queries/storage/attachment-references', () => ({
  useAttachmentReferencesQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@core/component/References', () => ({ References: () => null }));
beforeEach(() => {
  mocks.nameParts.mockReturnValue({
    firstName: 'Test',
    lastName: 'Owner',
    fullName: 'Test Owner',
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.pending = false;
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
      record={{ ...RECORD, createdBy: 'macro|owner@example.com' }}
    />
  ));
  expect(screen.queryByRole('switch')).toBeNull();
  expect(
    screen.getByText('Only Test Owner, who started the call, can change this.')
  ).toBeTruthy();
  expect(mocks.setShare).not.toHaveBeenCalled();
});

it('keeps the editable switch disabled while a share mutation is pending', () => {
  mocks.pending = true;
  render(() => <CallSidePanelSections callId="call" record={RECORD} />);
  const toggle = screen.getByRole('switch', { name: 'Share with team' });
  expect(toggle).toHaveProperty('disabled', true);
  fireEvent.click(toggle);
  expect(mocks.setShare).not.toHaveBeenCalled();
});

it('lets a participant change team sharing while the call is live', async () => {
  render(() => (
    <CallSidePanelSections
      callId="call"
      record={{ ...RECORD, isActive: true, createdBy: 'owner' }}
    />
  ));
  fireEvent.click(screen.getByRole('switch', { name: 'Share with team' }));
  await Promise.resolve();
  expect(mocks.liveShare).toHaveBeenCalledWith('call');
  expect(mocks.setShare).not.toHaveBeenCalled();
});

it('keeps the generic starter reason until an actual name resolves', () => {
  const [name, setName] = createSignal({
    firstName: '',
    lastName: '',
    fullName: 'owner@example.com',
  });
  mocks.nameParts.mockImplementation(name);
  render(() => (
    <CallSidePanelSections
      callId="call"
      record={{ ...RECORD, createdBy: 'macro|owner@example.com' }}
    />
  ));
  expect(screen.queryByText(/owner@example\.com/)).toBeNull();
  expect(
    screen.getByText('Only the person who started the call can change this.')
  ).toBeTruthy();
  setName({ firstName: 'Test', lastName: 'Owner', fullName: 'Test Owner' });
  expect(
    screen.getByText('Only Test Owner, who started the call, can change this.')
  ).toBeTruthy();
  expect(mocks.setShare).not.toHaveBeenCalled();
});
