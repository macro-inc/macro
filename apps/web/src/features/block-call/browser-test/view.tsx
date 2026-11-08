import '../../../index.css';
import type { CallRecord } from '@service-call/client';
import { Button } from '@ui';
import { render } from 'solid-js/web';
import { CallRecordingBody } from '../component/CallRecording/CallRecordingBody';
import { CallTranscriptButton } from '../component/CallRecording/CallTranscriptButton';
import { RecordingViewProvider } from '../context/recording-view';
import clip from './clip.webm?url';

const RECORD: CallRecord = {
  callId: 'fixture-call',
  customName: 'Recording fixture',
  createdBy: 'fixture-owner',
  startedAt: '2026-01-01T00:00:00Z',
  endedAt: '2026-01-01T00:00:02Z',
  recordingUrl: clip,
  isActive: false,
  shareWithTeam: false,
  participants: [],
  guests: [],
  discussion: { kind: 'call_chat', call_id: 'fixture-call' },
  transcript: [
    {
      transcriptId: 'fixture-segment',
      sequenceNum: 0,
      speakerId: 'fixture-speaker',
      startedAt: '2026-01-01T00:00:01Z',
      endedAt: '2026-01-01T00:00:02Z',
      content: 'Playback has one transcript line.',
    },
  ],
};

render(
  () => (
    <RecordingViewProvider callId={RECORD.callId}>
      <main class="flex h-screen flex-col">
        <header class="flex shrink-0 items-center gap-2 p-4">
          <span class="mr-auto">Recording fixture</span>
          <Button size="sm">Share</Button>
          <CallTranscriptButton />
        </header>
        <CallRecordingBody callId={RECORD.callId} record={RECORD} />
      </main>
    </RecordingViewProvider>
  ),
  document.getElementById('root')!
);
