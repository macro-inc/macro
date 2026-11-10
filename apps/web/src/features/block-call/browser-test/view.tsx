import '../../../index.css';
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  DEFAULT_THEMES,
} from '@app/features/theme/constants';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { SidePanel } from '@components/app/side-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { CallRecord } from '@service-call/client';
import { Button } from '@ui';
import { render } from 'solid-js/web';
import { CallRecordingBody } from '../component/CallRecording/CallRecordingBody';
import { CallRecordingRoot } from '../component/CallRecording/CallRecordingRoot';
import clip from './clip.webm?url';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const theme = new URLSearchParams(location.search).get('theme');
applyTheme(
  DEFAULT_THEMES.find((item) => item.id === theme)?.id ??
    (theme === 'light' ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME)
);
const RECORD: CallRecord = {
  callId: 'fixture-call',
  customName: 'Recording fixture',
  createdBy: 'fixture-owner',
  startedAt: '2026-01-01T00:00:00Z',
  endedAt: '2026-01-01T00:00:02Z',
  recordingUrl: new URLSearchParams(location.search).has('no-recording')
    ? null
    : clip,
  isActive: false,
  shareWithTeam: false,
  summary: [
    '## Conversation recap',
    ...Array.from(
      { length: 18 },
      (_, index) =>
        `### Topic ${index + 1}\nThe team reviewed the recording and discussed next steps, owners, and open questions. This summary has enough content to scroll the left column independently of the transcript.`
    ),
  ].join('\n\n'),
  participants: [],
  guests: [
    {
      id: 'fixture-guest',
      joinedAt: '2026-01-01T00:00:00Z',
      displayName: new URLSearchParams(location.search).has('long-name')
        ? 'A very long guest display name that must truncate without shifting transcript timestamps'
        : 'Another guest',
    },
  ],
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
    speakerId: index % 2 === 0 ? 'fixture-guest' : 'fixture-speaker',
    startedAt: new Date(
      Date.parse(RECORD.startedAt) + 1100 + index * 20
    ).toISOString(),
    endedAt: new Date(
      Date.parse(RECORD.startedAt) + 1120 + index * 20
    ).toISOString(),
    content:
      index === 0
        ? 'We can follow up on those changes tomorrow.'
        : `Additional transcript fixture line ${index + 1}.`,
  }))
);

render(
  () => (
    <CallRecordingRoot callId={RECORD.callId}>
      <main class="flex h-screen min-w-0">
        <aside
          aria-label="App sidebar"
          class="w-[330px] shrink-0 bg-surface max-[600px]:hidden"
        />
        <div
          id="fixture-pane"
          class="flex h-full min-w-0 flex-1 flex-col"
          style={{
            'max-width': new URLSearchParams(location.search).get('pane')
              ? `${new URLSearchParams(location.search).get('pane')}px`
              : undefined,
          }}
        >
          <SidePanel.Section
            id="fixture-details"
            title="Properties"
            defaultOpen
          >
            <div class="space-y-3">
              <p>Recording details fixture</p>
              <p>Stored call metadata</p>
              <p>Permission-scoped properties</p>
              <p>Recording references</p>
            </div>
          </SidePanel.Section>
          <header class="flex shrink-0 items-center gap-2 p-4 @container/split-header">
            <span class="mr-auto">Recording fixture</span>
            <SidePanel.HeaderActionsOutlet />
            <Button size="sm">Share</Button>
            <SidePanel.Toggle />
          </header>
          <CallRecordingBody callId={RECORD.callId} record={RECORD} />
        </div>
      </main>
    </CallRecordingRoot>
  ),
  document.getElementById('root')!
);
