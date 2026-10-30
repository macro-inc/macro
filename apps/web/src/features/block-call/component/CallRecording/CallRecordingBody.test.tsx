/**
 * @vitest-environment jsdom
 */

import type { CallRecord } from '@service-call/client';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallRecordingBody } from './CallRecordingBody';

const mocks = vi.hoisted(() => ({
  callAgain: vi.fn(),
  canCallAgain: true,
  activeCallId: null as string | null,
}));

vi.mock('../use-call-again', () => ({
  useCallAgain: () => ({
    canCallAgain: () => mocks.canCallAgain,
    callAgain: mocks.callAgain,
  }),
}));
vi.mock('@channel/Call/CallContext', () => ({
  useCallContextOptional: () => ({ activeCallId: () => mocks.activeCallId }),
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  AskMacroButton: () => null,
}));
vi.mock('@channel/Call/chat/CallChatHistory', () => ({
  CallChatHistory: () => null,
}));
vi.mock('@components/app/HeaderActionGroup', () => ({
  HeaderActionGroup: () => null,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: { HeaderActions: () => null },
}));
vi.mock('@core/component/CustomScrollbar', () => ({
  CustomScrollbar: () => null,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui', () => ({
  Button: (props: { onClick: () => void; children: JSX.Element }) => (
    <button onClick={() => props.onClick()}>{props.children}</button>
  ),
}));
vi.mock('./CallRecordingParticipants', () => ({
  CallRecordingParticipantsSection: () => null,
}));
vi.mock('./CallRecordingSummary', () => ({
  CallRecordingSummarySection: () => null,
}));

function callRecord(isActive: boolean): CallRecord {
  return {
    callId: 'call-id',
    channelId: 'channel-id',
    createdBy: 'user-id',
    guests: [],
    isActive,
    participants: [],
    roomName: 'room',
    shareWithTeam: false,
    startedAt: '2026-10-28T00:00:00Z',
    transcript: [],
  } as unknown as CallRecord;
}

beforeEach(() => {
  mocks.callAgain.mockReset();
  mocks.canCallAgain = true;
  mocks.activeCallId = null;
});

afterEach(cleanup);

describe('CallRecordingBody join button', () => {
  it('joins an in-progress call', () => {
    render(() => (
      <CallRecordingBody record={callRecord(true)} callId="call-id" />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Join call' }));
    expect(mocks.callAgain).toHaveBeenCalledOnce();
  });

  it('hides join for an ended call', () => {
    render(() => (
      <CallRecordingBody record={callRecord(false)} callId="call-id" />
    ));
    expect(screen.queryByRole('button', { name: 'Join call' })).toBeNull();
  });

  it('hides join when already in this call', () => {
    mocks.activeCallId = 'call-id';
    render(() => (
      <CallRecordingBody record={callRecord(true)} callId="call-id" />
    ));
    expect(screen.queryByRole('button', { name: 'Join call' })).toBeNull();
  });
});
