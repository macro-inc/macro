/** @vitest-environment jsdom */

import type { CallRecordTranscriptSegment } from '@service-storage/generated/schemas/callRecordTranscriptSegment';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallTranscript } from './CallTranscript';

const mocks = vi.hoisted(() => ({ senderFromStorageId: vi.fn() }));
vi.mock('@channel/Message', () => ({ Message: {} }));
vi.mock('@channel/Thread/Thread', () => ({ Thread: {} }));
vi.mock('@core/component/CustomScrollbar', () => ({
  CustomScrollbar: () => null,
}));
vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <span>Member avatar</span>,
}));
vi.mock('@core/user', () => ({
  idToEmail: (id: string) => id.replace('macro|', ''),
}));
vi.mock('@queries/channel/message-sender', () => ({
  senderFromStorageId: mocks.senderFromStorageId,
}));

const segment: CallRecordTranscriptSegment = {
  transcriptId: 'transcript-1',
  speakerId: 'guest:0199478d-1daf-798c-803a-9adc402b9367',
  sequenceNum: 1,
  content: 'A guest can contribute to the discussion.',
  startedAt: '2026-09-22T14:00:05Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('standalone and guest transcripts', () => {
  it('shows the guest name in a channel call without looking up a Macro sender', () => {
    const seek = vi.fn();
    render(() => (
      <CallTranscript
        transcript={[segment]}
        channelId="channel-1"
        speakerNames={new Map([[segment.speakerId, 'Ada']])}
        timelineStartMs={Date.parse('2026-09-22T14:00:00Z')}
        onSeekToSeconds={seek}
      />
    ));
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('Guest')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ada/ }));
    expect(seek).toHaveBeenCalledWith(5);
    expect(mocks.senderFromStorageId).not.toHaveBeenCalled();
  });

  it('renders a Macro participant in a standalone recording with no channel', () => {
    render(() => (
      <CallTranscript
        transcript={[{ ...segment, speakerId: 'macro|eric@example.com' }]}
        channelId={null}
        timelineStartMs={null}
      />
    ));
    expect(screen.getByText('eric@example.com')).toBeTruthy();
    expect(screen.getByText('Member avatar')).toBeTruthy();
    expect(mocks.senderFromStorageId).not.toHaveBeenCalled();
  });
});
