import { Show } from 'solid-js';
import type { WorkspaceTask } from '../../core/dummy-workspace';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { PrStatusIcon } from '../DemoPrDocument';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import '../tasks/task-stories.css';
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
import { HomepageConversation } from '../HomepageConversation';
import HomepageEmailCompose from '../HomepageEmailCompose';
import { HomepageMention } from '../HomepageMention';
import HomepagePullRequest from '../HomepagePullRequest';
import HomepageSpreadsheet from '../HomepageSpreadsheet';

/** The live homepage's open conversation leads into its full-size composer. */
export function EmailWorkflow(props: { phase: number }) {
  return (
    <div class="macro-email-story">
      <div class="macro-email-conversation">
        <HomepageConversation
          messages={[
            {
              person: 'julia',
              text: 'Can you send Valentina the demo follow-up?',
            },
          ]}
        />
        <div class="macro-email-step" data-visible={props.phase >= 1}>
          <HomepageConversation
            messages={[
              {
                person: 'jacob',
                text: (
                  <>
                    <span class="homepage-person-mention">@Macro</span> draft
                    Valentina’s follow-up from{' '}
                    <HomepageMention
                      kind="call"
                      label="Demo call transcript"
                      description="The demo with Valentina"
                      href="/calls"
                    />
                    . Link the sales PDF and rollout plan. Cc Julia.
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>
      <div
        class="macro-email-draft macro-email-step"
        data-visible={props.phase >= 2}
      >
        <HomepageEmailCompose
          animate={false}
          draft={{
            subject: 'Demo follow-up',
            to: 'Valentina <valentina@coparse.com>',
            cc: 'Julia <julia@macro.com>',
            body: '',
          }}
          bodyContent={
            <>
              <p class="macro-email-step" data-visible={props.phase >= 3}>
                Hi Valentina,
              </p>
              <p class="macro-email-step" data-visible={props.phase >= 4}>
                Thanks for joining the demo on September 14. Great meeting your
                team!
              </p>
              <p class="macro-email-step" data-visible={props.phase >= 5}>
                Here’s our{' '}
                <HomepageMention
                  kind="pdf"
                  label="Macro sales overview.pdf"
                  description="Macro product overview"
                  href="/documents"
                />{' '}
                and the{' '}
                <HomepageMention
                  kind="md"
                  label="Team rollout plan"
                  description="Setup steps and owners"
                  href="/documents"
                />
                .
              </p>
              <div class="macro-email-step" data-visible={props.phase >= 6}>
                <p>Best,</p>
                <p>Jacob</p>
              </div>
            </>
          }
        />
      </div>
    </div>
  );
}

/** Shared document edits use the same named carets as the document demos. */
export function DocumentWorkflow(props: { phase: number }) {
  return (
    <>
      <div class="macro-preview-back macro-workflow-document">
        <DocumentFrame title="Website launch plan">
          <p>Everything we need for the launch.</p>
          <p class="macro-collab-line" data-visible={props.phase >= 2}>
            Launch: Friday, October 23.
            <span
              class="doc-caret doc-named-caret"
              data-caret="julia"
              data-name="Julia"
            />
          </p>
          <h2>Before we go live</h2>
          <p class="macro-collab-line" data-visible={props.phase >= 4}>
            Review the pricing page and send the customer announcement.
            <span
              class="doc-caret doc-named-caret"
              data-caret="claude"
              data-name="Claude"
            />
          </p>
        </DocumentFrame>
      </div>
      <div class="macro-preview-front macro-preview-message">
        <HomepageConversation
          messages={[
            {
              person: 'julia',
              text: (
                <>
                  <span class="homepage-person-mention">@Claude</span> Add the
                  launch steps we agreed on in this channel.
                </>
              ),
            },
            ...(props.phase >= 6
              ? [
                  {
                    person: 'claude' as const,
                    text: (
                      <>
                        Updated the{' '}
                        <DocMention
                          item={{
                            kind: 'document',
                            label: 'Website launch plan',
                          }}
                        />
                        .
                      </>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
    </>
  );
}

/** The native task view follows its linked pull request from review to merge. */
export function TaskWorkflow(props: { phase: number }) {
  const workspace = createDummyWorkspace('tasks');
  const task = (): WorkspaceTask => ({
    ...workspace.data.tasks.find((item) => item.id === 'invite')!,
    title: 'Fix the sign-in button',
    description: 'The sign-in button does nothing on mobile.',
    channel: 'website',
    tags: ['Website'],
    status:
      props.phase >= 6
        ? 'Completed'
        : props.phase >= 3
          ? 'In Review'
          : 'In Progress',
    steps: [],
    comments: [],
  });
  const pr = () => (props.phase >= 5 ? 'merged' : 'open');
  return (
    <>
      <div class="macro-preview-back macro-workflow-task">
        <TaskNotebook
          workspace={workspace}
          task={task()}
          initialPanelOpen={false}
          hideCollectionNavigation
          pills={
            <Show when={props.phase >= 2}>
              <span class="task-pr-pill" data-status={pr()}>
                <PrStatusIcon status={pr()} class="size-3 shrink-0" />
                <span>Fix mobile sign-in</span>
                <span class="text-ink-muted">#491</span>
              </span>
            </Show>
          }
        />
      </div>
      <div class="macro-preview-front macro-preview-message">
        <HomepageConversation
          messages={[
            {
              person: 'julia',
              text: 'The sign-in button does nothing on mobile. Can you fix it?',
            },
            ...(props.phase >= 2
              ? [
                  {
                    person: 'cursor' as const,
                    text:
                      props.phase >= 5
                        ? 'Pull request #491 merged.'
                        : 'Opened pull request #491 for review.',
                  },
                ]
              : []),
          ]}
        />
      </div>
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
