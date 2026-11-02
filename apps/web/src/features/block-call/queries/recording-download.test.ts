import { Telemetry } from '@macro-inc/observability';
import type { CallRecord } from '@service-call/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@core/util/platformFetch', () => ({ platformFetch: mocks.fetch }));

import { callRecordingDownloadSource } from './recording-download';

const record = (recordingUrl?: string): CallRecord => ({
  callId: 'call-1',
  createdBy: 'macro|owner@macro.com',
  guests: [],
  isActive: false,
  participants: [],
  shareWithTeam: false,
  startedAt: '2026-10-27T10:00:00Z',
  transcript: [],
  recordingUrl,
});

const loadOptions = () => ({
  signal: new AbortController().signal,
  onProgress: vi.fn(),
  span: Telemetry.span('test.call_recording_download'),
});

beforeEach(() => vi.clearAllMocks());

describe('call recording download', () => {
  it('is unavailable until the call has a recording', () => {
    expect(callRecordingDownloadSource(record(), 'Weekly sync')).toBe(
      undefined
    );
  });

  it("saves the recording under the call's name and the recording's extension", async () => {
    mocks.fetch.mockResolvedValue(
      new Response('video', { headers: { 'Content-Type': 'video/mp4' } })
    );
    const source = callRecordingDownloadSource(
      record('https://recordings.example/calls/call-1/1730000000.mp4?sig=a.b'),
      'Weekly sync'
    );

    const result = await source?.load(loadOptions());

    expect(mocks.fetch.mock.calls[0][0]).toBe(
      'https://recordings.example/calls/call-1/1730000000.mp4?sig=a.b'
    );
    expect(result?._unsafeUnwrap().name).toBe('Weekly sync.mp4');
    expect(result?._unsafeUnwrap().blob.size).toBe(5);
  });
});
