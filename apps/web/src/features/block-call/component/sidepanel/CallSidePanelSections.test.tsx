// @vitest-environment jsdom
import type { CallRecord } from '@service-call/client';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallSidePanelSections } from './CallSidePanelSections';

const mocks = vi.hoisted(() => ({ liveShare: vi.fn(), savedShare: vi.fn() }));
vi.mock('@app/features/activity/views/entity-activity-section', () => ({
  EntityActivitySectionConditional: () => null,
}));
vi.mock('@app/features/property/side-panel/properties', () => ({
  EntityPropertiesSection: () => <p>Call properties</p>,
}));
vi.mock('@channel/Call/CallContext', () => ({
  useCallContextOptional: () => undefined,
}));
vi.mock('@core/block', () => ({ useBlockId: () => 'call-1' }));
vi.mock('@core/component/References', () => ({ References: () => null }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'owner' }));
vi.mock('@core/user', () => ({
  getDisplayName: () => 'Owner',
  tryMacroId: (id: string) => id,
}));
vi.mock('@core/util/date', () => ({ formatDate: () => 'September 18' }));
vi.mock('@queries/storage/attachment-references', () => ({
  useAttachmentReferencesQuery: () => ({ data: [] }),
}));
vi.mock('@queries/call/call', () => ({
  isCallSharedWithTeam: (record: CallRecord) =>
    record.channelId != null && record.shareWithTeam,
  useToggleShareWithTeamMutation: () => ({
    mutateAsync: mocks.liveShare,
    isPending: false,
  }),
  useSetCallRecordTeamShareMutation: () => ({
    mutateAsync: mocks.savedShare,
    isPending: false,
  }),
}));
vi.mock('@components/app/side-panel', () => {
  const Content = (props: { children: JSX.Element }) => (
    <div>{props.children}</div>
  );
  return {
    SidePanel: {
      Section: (props: { title: string; children: JSX.Element }) => (
        <section aria-label={props.title}>
          <h2>{props.title}</h2>
          {props.children}
        </section>
      ),
      Grid: Content,
      Row: Content,
      Pill: Content,
    },
  };
});
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  InlineCheckbox: () => null,
}));

function record(overrides: Partial<CallRecord>): CallRecord {
  return {
    callId: 'call-1',
    channelId: 'channel-1',
    createdBy: 'owner',
    isActive: false,
    participants: [],
    guests: [],
    roomName: 'room-1',
    shareWithTeam: true,
    startedAt: '2026-09-18T12:00:00Z',
    transcript: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.savedShare.mockResolvedValue({ shared: false });
});
afterEach(cleanup);

describe('call side panel team sharing', () => {
  it.each([false, true])(
    'omits team sharing for standalone calls (active: %s)',
    (isActive) => {
      render(() => (
        <CallSidePanelSections
          record={() => record({ channelId: null, isActive })}
        />
      ));
      expect(screen.queryByRole('region', { name: 'Sharing' })).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.getByRole('region', { name: 'Details' })).toBeTruthy();
      expect(screen.getByText('Call properties')).toBeTruthy();
      expect(mocks.liveShare).not.toHaveBeenCalled();
      expect(mocks.savedShare).not.toHaveBeenCalled();
    }
  );

  it('keeps the archived channel sharing control and removes it when the record changes to standalone', async () => {
    const [current, setCurrent] = createSignal(record({}));
    render(() => <CallSidePanelSections record={current} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Share with team' }));
    await vi.waitFor(() =>
      expect(mocks.savedShare).toHaveBeenCalledWith({
        callId: 'call-1',
        shared: false,
      })
    );
    setCurrent(record({ channelId: null }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Sharing' })).toBeNull();
  });
});
