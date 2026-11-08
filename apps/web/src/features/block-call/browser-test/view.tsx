import '../../../index.css';
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
} from '@app/features/theme/constants';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { SidePanel } from '@components/app/side-panel';
import type { CallRecord } from '@service-call/client';
import { Button } from '@ui';
import { render } from 'solid-js/web';
import { CallRecordingBody } from '../component/CallRecording/CallRecordingBody';
import { CallRecordingRoot } from '../component/CallRecording/CallRecordingRoot';
import { CallTranscriptButton } from '../component/CallRecording/CallTranscriptButton';
import clip from './clip.webm?url';

applyTheme(
  new URLSearchParams(location.search).get('theme') === 'light'
    ? DEFAULT_LIGHT_THEME
    : DEFAULT_DARK_THEME
);
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
RECORD.transcript.push(
  ...Array.from({ length: 32 }, (_, index) => ({
    transcriptId: `fixture-segment-${index + 1}`,
    sequenceNum: index + 1,
    speakerId: 'fixture-speaker',
    startedAt: new Date(
      Date.parse(RECORD.startedAt) + 1100 + index * 20
    ).toISOString(),
    endedAt: new Date(
      Date.parse(RECORD.startedAt) + 1120 + index * 20
    ).toISOString(),
    content: `Additional transcript fixture line ${index + 1}.`,
  }))
);

render(
  () => (
    <CallRecordingRoot callId={RECORD.callId}>
      <main class="flex h-screen flex-col">
        <SidePanel.Section id="fixture-details" title="Properties" defaultOpen>
          <p>Recording details fixture</p>
        </SidePanel.Section>
        <header class="flex shrink-0 items-center gap-2 p-4">
          <span class="mr-auto">Recording fixture</span>
          <Button size="sm">Share</Button>
          <CallTranscriptButton />
          <SidePanel.Toggle />
        </header>
        <CallRecordingBody callId={RECORD.callId} record={RECORD} />
      </main>
    </CallRecordingRoot>
  ),
  document.getElementById('root')!
);
