import Sparkle from '@phosphor/sparkle.svg';
import { UserMessageBubble } from '@ui/components/UserMessageBubble';
import { createSignal, lazy, Show, Suspense } from 'solid-js';
import { meetingDraft } from '../../core/email-demo-story';
import { createDemoPointer } from '../../primitives/createDemoPointer';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';
import { demoTypingActions } from '../../primitives/demoTypingActions';
import { DemoCursor } from '../DemoCursor';
import HomepageEmailCompose from '../HomepageEmailCompose';
import { HomepageMention } from '../HomepageMention';
import {
  ChannelComposer,
  type ChannelComposerHandle,
} from './frozen/ChannelComposer';
import { EmailShell } from './frozen/EmailShell';
import './email-feature-demos.css';
import './email-agentic-editing.css';

const EmailDemoSource = lazy(() => import('./EmailDemoSource'));

const request =
  'Draft a reply to Valentina confirming Thursday at 9. Use the call notes, include the setup plan and Macro overview, and copy Julia. Leave it as a draft.';

/** User request → source context → editable email, as in the app's agent chat. */
export function EmailAgenticEditingDemo() {
  let root!: HTMLDivElement;
  const [target, setTarget] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);
  const approach = (selector: string) => {
    setClicking(false);
    setTarget(selector);
  };
  const click = (run: () => void) => {
    setClicking(true);
    run();
  };

  let scroll!: HTMLDivElement;
  let draft!: HTMLDivElement;
  let composer: ChannelComposerHandle | undefined;
  const [phase, setPhase] = createSignal(0);
  const [prompt, setPrompt] = createSignal(request);
  const [source, setSource] = createSignal<'setup' | 'call'>();
  const workspace = createDummyWorkspace('documents');
  workspace.setData('documents', [
    {
      id: 'email-setup',
      title: 'Setup plan',
      body: '## Before Thursday\n\n- Connect your email inbox.\n- Invite your teammates.\n- Choose the documents to share with your team.\n\nJulia can help with setup before the demo at 9.',
      comments: [],
    },
  ]);
  workspace.open('documents', 'email-setup');
  let sourceTrigger: HTMLAnchorElement | undefined;
  const openSource = (kind: 'setup' | 'call', trigger: HTMLAnchorElement) => {
    playback.pause();
    sourceTrigger = trigger;
    setSource(kind);
  };
  const closeSource = () => {
    setSource(undefined);
    queueMicrotask(() => sourceTrigger?.focus({ preventScroll: true }));
  };
  const showDraft = () => {
    setPhase(3);
    composer?.setText('');
    queueMicrotask(() => {
      if (draft && scroll)
        scroll.scrollTo({
          top: scroll.scrollHeight,
          behavior: playback.reducedMotion() ? 'instant' : 'smooth',
        });
    });
  };
  const actions = [
    {
      delay: 900,
      run: () => approach('[aria-label="Message the email agent"]'),
    },
    { delay: 650, run: () => click(() => {}) },
    ...demoTypingActions(
      request,
      (text) => {
        setClicking(false);
        setTarget(undefined);
        composer?.setText(text);
      },
      250
    ),
    { delay: 700, run: () => approach('[aria-label="Send demo message"]') },
    {
      delay: 650,
      run: () =>
        click(() => {
          setPhase(1);
          composer?.setText('');
        }),
    },
    { delay: 200, run: () => setClicking(false) },
    { delay: 1600, run: () => setPhase(2) },
    { delay: 2200, run: showDraft },
  ];
  const playback = createEmailWalkthrough({
    root: () => root,
    steps: actions.length,
    visibilityThreshold: 0.45,
    delay: (step) => actions[step - 1].delay,
    loop: { hold: 8000 },
    reset: () => {
      setTarget(undefined);
      setClicking(false);
      setPhase(0);
      setPrompt(request);
      composer?.setText('');
    },
    reduced: () => {
      setPhase(3);
      composer?.setText('');
    },
    advance: (step) => actions[step - 1].run(),
  });
  const pointer = createDemoPointer({
    frame: () => root,
    target,
    active: () => playback.playing() && !playback.reducedMotion(),
  });
  return (
    <div
      ref={root}
      class="email-editing-stage email-feature-demo"
      data-phase={phase()}
      onPointerDown={playback.pause}
      onFocusIn={playback.pause}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && source() && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          closeSource();
        }
      }}
    >
      <EmailShell label="Draft a reply from your work" showRail={false}>
        <div class="email-agent-splits" data-source-open={!!source()}>
          <Show when={source()} keyed>
            {(kind) => (
              <section
                class="email-agent-source workspace-demo dummy-workspace"
                aria-label="Linked source"
              >
                <Suspense fallback={<p role="status">Opening source…</p>}>
                  <EmailDemoSource
                    source={kind}
                    workspace={workspace}
                    onBack={closeSource}
                    onReady={() =>
                      root
                        .querySelector<HTMLElement>(
                          '.email-agent-source button'
                        )
                        ?.focus({ preventScroll: true })
                    }
                  />
                </Suspense>
              </section>
            )}
          </Show>
          <div class="email-agent-main">
            <header class="email-feature-toolbar email-draft-title">
              <Sparkle />
              <span>Draft a follow-up</span>
            </header>
            <div ref={scroll} class="email-agent-scroll">
              <div class="email-agent-content">
                <Show when={phase() >= 1}>
                  <div class="email-agent-request">
                    <UserMessageBubble>{prompt()}</UserMessageBubble>
                  </div>
                </Show>
                <Show when={phase() >= 2}>
                  <div class="email-agent-context">
                    Thursday at 9 is confirmed in the{' '}
                    <HomepageMention
                      kind="call"
                      label="Demo call"
                      description="Valentina confirmed Thursday at 9. Julia will help with setup."
                      href="/calls"
                      onOpen={(trigger) => openSource('call', trigger)}
                    />
                    . The{' '}
                    <HomepageMention
                      kind="md"
                      label="Setup plan"
                      description="Connect your email, invite your teammates, and choose the documents to share. Julia can help."
                      href="/documents"
                      onOpen={(trigger) => openSource('setup', trigger)}
                    />{' '}
                    covers the setup steps.
                  </div>
                </Show>
                <Show when={phase() >= 3}>
                  <div ref={draft} class="email-agent-draft">
                    <HomepageEmailCompose
                      appChrome
                      draft={meetingDraft}
                      bodyContent={
                        <>
                          <p>Hi Valentina,</p>
                          <p>Thursday at 9 works.</p>
                          <p>
                            Here’s the{' '}
                            <HomepageMention
                              kind="md"
                              label="Setup plan"
                              description="Connect your email, invite your teammates, and share your documents."
                              href="/documents"
                              onOpen={(trigger) => openSource('setup', trigger)}
                            />{' '}
                            and our{' '}
                            <HomepageMention
                              kind="pdf"
                              label="Macro overview.pdf"
                              description="A short overview of Macro and how to get started."
                              href="/documents"
                            />
                            .
                          </p>
                          <p>I’ve copied Julia, who can help with setup.</p>
                          <p>
                            See you Thursday,
                            <br />
                            Jacob
                          </p>
                        </>
                      }
                    />
                  </div>
                </Show>
              </div>
            </div>
            <div class="email-agent-input">
              <ChannelComposer
                agent
                label="Message the email agent"
                placeholder="Ask a follow-up..."
                onReady={(handle) => {
                  composer = handle;
                }}
                onSend={(text) => {
                  playback.pause();
                  setPrompt(text);
                  showDraft();
                }}
              />
            </div>
          </div>
        </div>
      </EmailShell>
      <Show when={pointer()}>
        {(point) => (
          <DemoCursor
            class="email-demo-pointer"
            clicking={clicking()}
            style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}
