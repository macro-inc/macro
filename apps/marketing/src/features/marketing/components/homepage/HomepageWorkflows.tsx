import CheckSquare from '@phosphor/check-square.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { meetingEmail } from '../../core/email-demo-story';
import { homepagePeople } from '../../core/homepage-demo-people';
import { AgentToolGroup } from '../agents/AgentTranscript';
import {
  type CallPlayback,
  CallTranscriptBox,
  RecordingPlayer,
} from '../calls/CallRecord';
import { trainingReview } from '../calls/call-fixtures';
import { CompanyKanbanCardSurface } from '../DemoCompanyKanban';
import { DocMention } from '../documents/DocMention';
import { DocumentFrame } from '../documents/DocumentFrame';
import { ChannelResult, ShareForm } from '../email/EmailSharingDemo';
import { EmailThread } from '../email/frozen/EmailThread';
import { HomepageConversation } from '../HomepageConversation';
import { HomepageMention } from '../HomepageMention';
import HomepagePullRequest from '../HomepagePullRequest';
import HomepageSpreadsheet from '../HomepageSpreadsheet';

export function EmailWorkflow(props: {
  phase: number;
  advance: (phase: number) => void;
}) {
  return (
    <>
      <div class="macro-preview-back macro-workflow-email">
        <EmailThread
          email={meetingEmail}
          hideReply
          onShare={() => props.advance(2)}
        />
      </div>
      <div
        class="macro-preview-front macro-workflow-channel"
        data-complete={props.phase >= 6}
      >
        <ChannelResult
          shared={props.phase >= 6}
          updated={props.phase >= 7}
          onOpen={() => props.advance(0)}
        />
      </div>
      <Show when={props.phase >= 2 && props.phase < 6}>
        <div class="macro-workflow-modal">
          <ShareForm
            phase={props.phase}
            query="launch"
            message={props.phase >= 4 ? 'Here’s the email for Thursday.' : ''}
            advance={() => props.advance(props.phase < 3 ? 3 : 6)}
            cancel={() => props.advance(0)}
          />
        </div>
      </Show>
    </>
  );
}

/** Checkbox selection → MarkdownPopup's Tasks action → native task mention. */
export function DocumentWorkflow(props: {
  phase: number;
  advance: (phase: number) => void;
}) {
  return (
    <>
      <div class="macro-preview-back macro-workflow-document">
        <DocumentFrame title="Website launch plan">
          <p>Everything we need for Friday’s launch.</p>
          <h2>Before we go live</h2>
          <Show
            when={props.phase >= 4}
            fallback={
              <p
                class="macro-task-selection"
                data-selected={props.phase >= 1}
                data-task-selection
              >
                <input type="checkbox" tabIndex={-1} /> Prepare the launch
                checklist
              </p>
            }
          >
            <p data-created-task>
              <DocMention
                item={{
                  kind: 'task',
                  label: 'Prepare the launch checklist',
                  status: 'Not Started',
                }}
              />
            </p>
          </Show>
          <Show when={props.phase >= 2 && props.phase < 4}>
            <div class="macro-selection-menu">
              <Button
                size="sm"
                onClick={() => props.advance(4)}
                data-convert-task
              >
                <CheckSquare />
                Tasks
              </Button>
            </div>
          </Show>
          <p>
            Share the plan with{' '}
            <DocMention item={{ kind: 'person', label: 'Teo' }} />.
          </p>
        </DocumentFrame>
      </div>
      <Show when={props.phase >= 5}>
        <div class="macro-preview-front macro-preview-task macro-workflow-result">
          <DocMention
            item={{
              kind: 'task',
              label: 'Prepare the launch checklist',
              status: 'Not Started',
            }}
          />
          <div class="macro-preview-task-meta">
            <span>Not Started</span>
            <img src={homepagePeople.jacob.photo} alt="" />
            <span>Jacob</span>
          </div>
          <HomepageMention
            kind="md"
            label="Website launch plan"
            description="Source document"
            href="/documents"
          />
        </div>
      </Show>
    </>
  );
}

export function AgentWorkflow(props: { phase: number }) {
  return (
    <>
      <div class="macro-preview-back macro-workflow-agent">
        <HomepageConversation
          messages={[
            {
              person: 'teo',
              text: (
                <>
                  <span class="homepage-person-mention">@Cursor</span>{' '}
                  investigate the failing deploy and fix it on this branch.
                </>
              ),
            },
          ]}
        />
        <Show when={props.phase >= 2}>
          <AgentToolGroup
            open
            active={props.phase < 5}
            calls={[
              { kind: 'action', label: 'Read deploy logs' },
              ...(props.phase >= 3
                ? [{ kind: 'action' as const, label: 'Edit retry helper' }]
                : []),
              ...(props.phase >= 4
                ? [{ kind: 'action' as const, label: 'Run tests · 12 passed' }]
                : []),
            ]}
          />
        </Show>
      </div>
      <Show when={props.phase >= 5}>
        <div class="macro-workflow-agent-result">
          <HomepagePullRequest />
        </div>
      </Show>
    </>
  );
}

export function SheetWorkflow(props: { phase: number }) {
  return (
    <>
      <div class="macro-preview-back">
        <div class="macro-preview-sheet">
          <HomepageSpreadsheet />
        </div>
      </div>
      <Show when={props.phase >= 3}>
        <div class="macro-preview-front macro-preview-company macro-workflow-result">
          <CompanyKanbanCardSurface
            icon={<span class="homepage-crm-company-mark">C</span>}
            title="Coparse"
            owner={
              <img
                class="ml-auto size-6 rounded-full"
                src={homepagePeople.valentina.photo}
                alt=""
              />
            }
            domain="coparse.com"
            updatedAt={<span class="ml-auto">Today</span>}
          />
          <div class="macro-company-detail">
            <span>Contacts</span>
            <DocMention item={{ kind: 'person', label: 'Valentina' }} />
            <span>Related email</span>
            <HomepageMention
              kind="email"
              label="Thursday demo"
              description="Customer conversation"
              href="/email"
            />
          </div>
        </div>
      </Show>
    </>
  );
}

export function CallWorkflow(props: { phase: number; playback: CallPlayback }) {
  return (
    <>
      <div class="macro-preview-back macro-workflow-recording">
        <RecordingPlayer call={trainingReview} playback={props.playback} />
      </div>
      <div class="macro-preview-front macro-call-transcript">
        <CallTranscriptBox
          segments={trainingReview.segments.slice(0, 3)}
          playback={props.playback}
          maxHeight={280}
        />
      </div>
    </>
  );
}
