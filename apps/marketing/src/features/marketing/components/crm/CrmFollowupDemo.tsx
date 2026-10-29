import ArrowLeft from '@phosphor/arrow-left.svg';
import { Button } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import type { WorkspaceView } from '../../core/dummy-workspace';
import { createCrmDemoWorkspace } from '../../primitives/createCrmDemoWorkspace';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { AgentSession } from '../agents/AgentSession';
import {
  AgentAnswer,
  type AgentMention,
  AgentPrompt,
  type AgentToolCall,
  AgentToolGroup,
  AgentTurn,
} from '../agents/AgentTranscript';
import {
  CallRecordBody,
  CallRecordTopBar,
  createCallPlayback,
} from '../calls/CallRecord';
import { DemoPrDocument } from '../DemoPrDocument';
import { DocMention } from '../documents/DocMention';
import HomepageEmailCompose from '../HomepageEmailCompose';
import { ProductDemo } from '../product/ProductPage';
import { PrMention } from '../reviews/ReviewPrMention';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import type { CompanySection } from '../workspace/WorkspaceCompanies';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import { WorkspaceEmail } from '../workspace/WorkspaceEmail';
import { WorkspaceTasks } from '../workspace/WorkspaceTasks';
import { CrmRecordWorkspace } from './CrmRecordWorkspace';
import {
  followupCall,
  followupDraft,
  followupIds,
  followupPr,
  followupPrompt,
  seedCrmFollowup,
} from './crm-followup-data';
import '../calls/call-stories.css';
import '../reviews/review-stories.css';
import './crm-followup-demo.css';

type Source = 'company' | 'email' | 'call' | 'file' | 'task' | 'chat' | 'pr';

/** Chat-first walkthrough; linked sources open only on visitor request. */
export function CrmFollowupDemo() {
  let frame!: HTMLDivElement;
  let opener: HTMLElement | undefined;
  const w = createCrmDemoWorkspace();
  seedCrmFollowup(w);
  const [phase, setPhase] = createSignal(0);
  const [source, setSource] = createSignal<Source | undefined>();
  const [sourceId, setSourceId] = createSignal<string>();
  const [section, setSection] = createSignal<CompanySection>('overview');
  const [toolsOpen, setToolsOpen] = createSignal(true);
  const callPlayback = createCallPlayback(followupCall.duration);
  const finish = () => {
    w.open('crm', followupIds.company);
    setPhase(8);
    setSource(undefined);
    setToolsOpen(false);
    queueMicrotask(() => {
      const log = frame.querySelector<HTMLElement>('.agent-transcript');
      const result = frame.querySelector<HTMLElement>('.crm-followup-result');
      if (log && result)
        log.scrollTop +=
          result.getBoundingClientRect().top -
          log.getBoundingClientRect().top -
          16;
    });
  };
  const playback = createProductWalkthrough({
    root: () => frame,
    steps: 10,
    visibilityThreshold: 0.45,
    loop: { hold: 10000 },
    reset: () => {
      setPhase(0);
      setSource(undefined);
      setSection('overview');
      setToolsOpen(true);
      w.open('crm', followupIds.company);
      frame
        .querySelectorAll<HTMLElement>('.agent-transcript, .dummy-scroll')
        .forEach((el) => {
          el.scrollTop = 0;
        });
    },
    reduced: finish,
    delay: (step) => (step === 1 ? 1200 : step >= 9 ? 6500 : 1800),
    advance: (step) => {
      setPhase(step);
      if (step === 1) w.open('crm', followupIds.company);
      if (step === 8) finish();
      if (step >= 9)
        queueMicrotask(() => {
          const log = frame.querySelector<HTMLElement>('.agent-transcript');
          const draft = frame.querySelector<HTMLElement>(
            '.homepage-email-demo'
          );
          if (!log) return;
          const top =
            step === 9 && draft
              ? log.scrollTop +
                draft.getBoundingClientRect().top -
                log.getBoundingClientRect().top -
                16
              : log.scrollHeight;
          log.scrollTo({ top, behavior: 'smooth' });
        });
    },
  });
  const pause = () => {
    playback.pause();
    callPlayback.pause();
  };
  const open = (kind: Source, trigger?: HTMLButtonElement, id?: string) => {
    setSourceId(id);
    pause();
    if (!source() || !opener?.isConnected) {
      opener =
        trigger ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined);
    }
    if (kind === 'company') {
      w.open('crm', followupIds.company);
      setSection('overview');
    }
    setSource(kind);
    queueMicrotask(() => {
      frame
        .querySelector<HTMLButtonElement>('.crm-followup-back button')
        ?.focus({ preventScroll: true });
      frame.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    });
  };
  const close = () => {
    pause();
    setSource(undefined);
    queueMicrotask(() => {
      const target = opener?.isConnected
        ? opener
        : frame.querySelector<HTMLElement>(
            '.crm-followup-agent [aria-label="Message the agent"]'
          );
      target?.focus({ preventScroll: true });
    });
  };
  const openItem = (view: WorkspaceView, id?: string) => {
    if (view === 'email') open('email', undefined, id);
    if (view === 'documents') open('file', undefined, id);
    if (view === 'tasks') open('task', undefined, id);
    if (view === 'messages') open('chat', undefined, id);
  };
  const sourceView = (): WorkspaceView =>
    source() === 'email'
      ? 'email'
      : source() === 'file'
        ? 'documents'
        : source() === 'task'
          ? 'tasks'
          : source() === 'chat'
            ? 'messages'
            : 'crm';
  const selected = () =>
    sourceId() ??
    (source() === 'email'
      ? followupIds.email
      : source() === 'file'
        ? followupIds.file
        : source() === 'task'
          ? followupIds.task
          : followupIds.company);
  const linked: DummyWorkspace = {
    ...w,
    view: sourceView,
    contentView: sourceView,
    selected,
    channel: () => followupIds.chat,
    open: openItem,
    openItem,
    backToCollection: close,
  };
  const calls: AgentToolCall[] = [
    { kind: 'action', label: 'Read company: Parlor Studio' },
    { kind: 'read-thread' },
    { kind: 'read-call' },
    { kind: 'read-document', title: 'Setup guide' },
    { kind: 'action', label: 'Read task: Verify folder uploads in production' },
    { kind: 'read-channel', channel: 'customer-followup', count: 3 },
    { kind: 'action', label: 'Read pull request #248: Fix folder uploads' },
  ];
  const mentions: Record<string, AgentMention> = {
    email: { kind: 'email', onOpen: (t) => open('email', t) },
    call: { kind: 'call', onOpen: (t) => open('call', t) },
    file: { kind: 'document', onOpen: (t) => open('file', t) },
    task: { kind: 'task', onOpen: (t) => open('task', t) },
    chat: { kind: 'channel', onOpen: (t) => open('chat', t) },
    teo: { kind: 'person', person: 'teo' },
    julia: { kind: 'person', person: 'julia' },
  };
  return (
    <div
      ref={frame}
      class="crm-demo-frame crm-followup-demo"
      data-phase={phase()}
      data-source-open={!!source()}
      data-source={source()}
      onFocusIn={pause}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && source() && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <ProductDemo
        label="Prepare a customer follow-up from the company’s linked work"
        height={700}
        mobileHeight={740}
        onInteract={pause}
      >
        <div class="crm-followup-splits">
          <Show when={source()}>
            <section class="crm-followup-source" aria-label="Customer context">
              <div class="crm-followup-back">
                <Button variant="plain" size="sm" onClick={close}>
                  <ArrowLeft />
                  Back to follow-up
                </Button>
              </div>
              <div class="crm-followup-source-body">
                <Switch>
                  <Match when={source() === 'company'}>
                    <CrmRecordWorkspace
                      workspace={w}
                      hideCopyLink
                      section={section()}
                      onSectionChange={(section) => {
                        pause();
                        setSection(section);
                      }}
                      onOpenItem={openItem}
                      onOpenCall={() => open('call')}
                      onOpenTask={(id) => open('task', undefined, id)}
                    />
                  </Match>
                  <Match when={source() === 'email'}>
                    <WorkspaceEmail
                      workspace={linked}
                      tab="all"
                      account="all"
                      hideCollectionNavigation
                    />
                  </Match>
                  <Match when={source() === 'file'}>
                    <WorkspaceDocuments workspace={linked} />
                  </Match>
                  <Match when={source() === 'task'}>
                    <WorkspaceTasks workspace={linked} filter="all" />
                  </Match>
                  <Match when={source() === 'chat'}>
                    <WorkspaceChannel
                      workspace={linked}
                      renderMessageBody={(message) => {
                        if (message.id === 'followup-chat-1')
                          return (
                            <>
                              Ava at{' '}
                              <button
                                type="button"
                                class="crm-followup-file"
                                onClick={() => open('company')}
                              >
                                <DocMention
                                  item={{
                                    kind: 'company',
                                    label: 'Parlor Studio',
                                  }}
                                />
                              </button>{' '}
                              asked if folder uploads will be ready for
                              Thursday. Can we confirm?
                            </>
                          );
                        if (message.id === 'followup-chat-2')
                          return (
                            <>
                              <PrMention
                                pr={followupPr}
                                status="merged"
                                onOpen={() => open('pr')}
                              />{' '}
                              is merged. I’m checking the production release
                              now. Please wait for that check before promising
                              it is ready.
                            </>
                          );
                        if (message.id === 'followup-chat-3')
                          return (
                            <>
                              I can help with setup at 9. Please ask Ava for the
                              attendee names and send the{' '}
                              <button
                                type="button"
                                class="crm-followup-file"
                                onClick={() => open('file')}
                              >
                                <DocMention
                                  item={{
                                    kind: 'document',
                                    label: 'Setup guide',
                                  }}
                                />
                              </button>
                              .
                            </>
                          );
                        return undefined;
                      }}
                    />
                  </Match>
                  <Match when={source() === 'call'}>
                    <CallRecordTopBar title={followupCall.title} />
                    <CallRecordBody
                      call={followupCall}
                      playback={callPlayback}
                    />
                  </Match>
                  <Match when={source() === 'pr'}>
                    <div class="dummy-scroll crm-followup-pr">
                      <DemoPrDocument
                        merged
                        record={{
                          name: followupPr.title,
                          description: followupPr.description,
                          repository: followupPr.repo,
                          number: followupPr.number,
                        }}
                      />
                    </div>
                  </Match>
                </Switch>
              </div>
            </section>
          </Show>
          <section class="crm-followup-agent" aria-label="Follow-up agent">
            <AgentSession
              title="Follow up with Parlor Studio"
              onSend={() => {
                pause();
                finish();
              }}
            >
              <AgentTurn>
                <AgentPrompt text={followupPrompt} />
              </AgentTurn>
              <AgentTurn>
                <Show when={phase() > 0}>
                  <AgentToolGroup
                    calls={calls.slice(0, Math.min(phase(), 7))}
                    active={phase() < 8}
                    open={toolsOpen()}
                    onOpenChange={setToolsOpen}
                  />
                </Show>
              </AgentTurn>
              <Show when={phase() >= 8}>
                <AgentTurn>
                  <div class="crm-followup-result">
                    <AgentAnswer
                      text="Ava asked whether uploads are ready in @[Thursday demo](agent:email). The @[prep call](agent:call) and @[team chat](agent:chat) agree: the fix merged, but Teo still needs to verify the release."
                      mentions={mentions}
                    />
                    <p class="crm-followup-pr-link">
                      <PrMention
                        pr={followupPr}
                        status="merged"
                        onOpen={() => open('pr')}
                      />
                    </p>
                    <HomepageEmailCompose
                      appChrome
                      draft={followupDraft}
                      bodyContent={
                        <>
                          <p>Hi Ava,</p>
                          <p>
                            Thursday at 9 works. The folder-upload fix has
                            merged, and Teo is checking the production release.
                            I’ll confirm once it’s ready to try.
                          </p>
                          <p>
                            Here’s the{' '}
                            <span contentEditable={false}>
                              <button
                                type="button"
                                class="crm-followup-file"
                                onClick={() => open('file')}
                              >
                                <DocMention
                                  item={{
                                    kind: 'document',
                                    label: 'Setup guide',
                                  }}
                                />
                              </button>
                            </span>
                            . I’ve copied Julia, who can help with setup. Could
                            you send her the names of the people joining?
                          </p>
                          <p>
                            See you Thursday,
                            <br />
                            Jacob
                          </p>
                        </>
                      }
                    />
                    <AgentAnswer
                      text={
                        '**Next steps**\n\n- @[Teo](agent:teo): finish @[production verification](agent:task) before confirming readiness.\n- @[Julia](agent:julia): get the attendee names and share the @[setup guide](agent:file).\n- Jacob: review the draft, then confirm Thursday at 9 with Ava.'
                      }
                      mentions={mentions}
                    />
                    <Button
                      variant="plain"
                      size="sm"
                      onClick={(event) => open('company', event.currentTarget)}
                    >
                      Open Parlor Studio
                    </Button>
                  </div>
                </AgentTurn>
              </Show>
            </AgentSession>
          </section>
        </div>
      </ProductDemo>
    </div>
  );
}
