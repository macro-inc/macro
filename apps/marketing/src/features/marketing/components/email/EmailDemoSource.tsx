import { createSignal, Match, onMount, Switch } from 'solid-js';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import {
  CallRecordBody,
  CallRecordTopBar,
  createCallPlayback,
} from '../calls/CallRecord';
import type { SampleCall } from '../calls/call-fixtures';
import { DocumentShareSheet } from '../documents/DocumentShareSheet';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import '../calls/call-stories.css';
import '../workspace/dummy-workspace.css';

const call: SampleCall = {
  title: 'Demo call',
  ended: 'Oct 14, 2026 · 9:20 AM',
  duration: 1200,
  people: ['jacob', 'valentina', 'julia'],
  summary:
    '- Valentina confirmed Thursday at 9.\n- Send the setup plan and Macro overview before the meeting.\n- Julia will help with setup.',
  segments: [
    {
      id: 'time',
      person: 'valentina',
      at: 30,
      text: 'Thursday at 9 works for me. Could you send the setup plan before we meet?',
    },
    {
      id: 'setup',
      person: 'julia',
      at: 45,
      text: 'I can help with setup. Connect your email, invite your teammates, and choose the documents to share.',
    },
    {
      id: 'followup',
      person: 'jacob',
      at: 65,
      text: 'I’ll send the setup plan and Macro overview, and copy Julia.',
    },
  ],
  poster: [
    { person: 'jacob', video: false },
    { person: 'valentina', video: false },
    { person: 'julia', video: false },
  ],
};

/** The existing native document and call viewers, opened from the draft's citations. */
export default function EmailDemoSource(props: {
  source: 'setup' | 'call';
  workspace: DummyWorkspace;
  onBack: () => void;
  onReady?: () => void;
}) {
  const playback = createCallPlayback(call.duration);
  onMount(() => props.onReady?.());
  const [sharing, setSharing] = createSignal(false);
  const workspace = { ...props.workspace, backToCollection: props.onBack };
  return (
    <Switch>
      <Match when={props.source === 'setup'}>
        <WorkspaceDocuments
          workspace={workspace}
          backLabel="Back to draft"
          onShare={() => setSharing(true)}
        />
        <DocumentShareSheet
          open={sharing()}
          title="Setup plan"
          onClose={() => setSharing(false)}
        />
      </Match>
      <Match when={props.source === 'call'}>
        <CallRecordTopBar title={call.title} onBack={props.onBack} />
        <CallRecordBody call={call} playback={playback} />
      </Match>
    </Switch>
  );
}
