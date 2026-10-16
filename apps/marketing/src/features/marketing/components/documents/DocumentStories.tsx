import Cloud from '@phosphor/cloud.svg';
import CloudWarning from '@phosphor/cloud-warning.svg';
import { Tooltip } from '@ui/components/Tooltip';
import { createSignal, Show } from 'solid-js';
import { type AgentToolCall, AgentToolGroup } from '../agents/AgentTranscript';
import { HomepageConversation } from '../HomepageConversation';
import { HomepageMention } from '../HomepageMention';
import { ProductDemo } from '../product/ProductPage';
import { DocumentFrame } from './DocumentFrame';
import {
  type DocumentSource,
  DocumentSourceSurface,
} from './DocumentProjectDemo';
import { PROJECT_INTRO, PROJECT_TAGS, PROJECT_TITLE } from './documentProject';
import { createSceneClock, typed } from './documentScene';

export { DocumentMentionsDemo } from './DocumentMentionsDemo';
export { DocumentSharingDemo } from './DocumentSharingDemo';

function Caret(props: { who: 'claude' | 'jacob' | 'julia' }) {
  return (
    <span
      class="doc-caret doc-named-caret"
      data-caret={props.who}
      data-name={
        props.who === 'claude'
          ? 'Macro'
          : props.who === 'julia'
            ? 'Julia'
            : 'Jacob'
      }
    />
  );
}
export function DocumentAgentDemo() {
  let editorRoot!: HTMLDivElement;
  const clock = createSceneClock({
    root: () => editorRoot,
    end: 10200,
    lead: 900,
  });
  const [source, setSource] = createSignal<DocumentSource>();
  const [searchOpen, setSearchOpen] = createSignal(true);
  const [toolsOpen, setToolsOpen] = createSignal<boolean>();
  let trigger: HTMLElement | undefined;
  const pause = () => clock.pause();
  const open = (next: DocumentSource) => {
    pause();
    trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    setSource(next);
  };
  const close = () => {
    setSource(undefined);
    trigger?.focus({ preventScroll: true });
  };
  const calls: AgentToolCall[] = [
    {
      kind: 'search',
      query: 'website pricing',
      hits: [
        {
          kind: 'email',
          title: 'Pricing changes',
          sender: 'Julia',
          snippet: 'Annual gets two months free. Keep the free plan visible.',
          time: 'Today',
          onOpen: () => open('email'),
        },
        {
          kind: 'task',
          title: 'Update pricing page',
          snippet: 'Teo · In Progress · Check mobile before publishing.',
          time: 'Today',
          onOpen: () => open('task'),
        },
      ],
    },
    { kind: 'read-thread' },
    { kind: 'read-document', title: 'Update pricing page' },
    { kind: 'action', label: 'Edit Website brief' },
  ];
  return (
    <div class="doc-story doc-agent-rebuilt" data-live={clock.live()}>
      <div
        class="doc-agent-conversation"
        onPointerDown={pause}
        onKeyDown={pause}
      >
        <HomepageConversation
          messages={[
            {
              person: 'julia',
              text: (
                <>
                  <span class="homepage-person-mention">@Macro</span> update{' '}
                  <HomepageMention
                    kind="md"
                    label={PROJECT_TITLE}
                    description="The website copy and pricing changes."
                    href="#document-agents"
                  />{' '}
                  from the latest pricing email.
                </>
              ),
            },
          ]}
        />
      </div>
      <div
        class="doc-agent-tools workspace-demo"
        data-open={toolsOpen() ?? !clock.done()}
        data-theme="dark"
        onPointerDown={pause}
        onKeyDown={pause}
      >
        <AgentToolGroup
          open={toolsOpen() ?? !clock.done()}
          onOpenChange={setToolsOpen}
          animateCollapse
          active={clock.live() && !clock.done()}
          searchOpen={searchOpen()}
          onSearchOpenChange={setSearchOpen}
          calls={calls.slice(
            0,
            clock.t() < 1600
              ? 1
              : clock.t() < 2500
                ? 2
                : clock.t() < 3200
                  ? 3
                  : 4
          )}
        />
      </div>
      <ProductDemo
        ref={(element) => {
          editorRoot = element;
        }}
        label="An agent and Jacob edit the Website brief together"
        height={480}
        mobileHeight={530}
        onInteract={pause}
      >
        <DocumentSourceSurface source={source()} onClose={close}>
          <DocumentFrame title={PROJECT_TITLE} tags={PROJECT_TAGS}>
            <h2>Pricing</h2>
            <p class="doc-stable-edit">
              <span
                class="doc-edit-measure"
                aria-hidden="true"
                contentEditable={false}
                data-content={`${PROJECT_INTRO} Link to the billing FAQ below the table.`}
              />
              <span class="doc-edit-live">
                <Show
                  when={clock.t() >= 3600}
                  fallback={
                    <span
                      class={
                        clock.t() >= 3200 ? 'doc-story-selected' : undefined
                      }
                    >
                      Show monthly pricing. Add annual plans later.
                    </span>
                  }
                >
                  {typed(PROJECT_INTRO, clock.t(), 3600, 8200)}
                </Show>
                <Show
                  when={clock.live() && clock.t() >= 3200 && clock.t() < 8400}
                >
                  <Caret who="claude" />
                </Show>
                {typed(
                  ' Link to the billing FAQ below the table.',
                  clock.t(),
                  5000,
                  9500
                )}
                <Show
                  when={clock.live() && clock.t() >= 5000 && clock.t() < 9700}
                >
                  <Caret who="jacob" />
                </Show>
              </span>
            </p>
            <h2>Before we publish</h2>
            <ul class="md-list">
              <li>Teo checks the pricing table.</li>
              <li>Julia reviews the copy.</li>
              <li>Jacob tests signup on mobile.</li>
            </ul>
            <h2>Launch</h2>
            <p>
              Publish once pricing and signup are checked. Send the announcement
              the next morning.
            </p>
          </DocumentFrame>
        </DocumentSourceSurface>
      </ProductDemo>
    </div>
  );
}

export function DocumentOfflineDemo() {
  let root!: HTMLDivElement;
  const clock = createSceneClock({ root: () => root, end: 6800, lead: 800 });
  const status = () =>
    clock.t() < 4800 ? 'offline' : clock.t() < 6000 ? 'connecting' : undefined;
  return (
    <div ref={root} class="doc-story" data-live={clock.live()}>
      <ProductDemo
        label="Offline edits merge when you reconnect"
        height={370}
        mobileHeight={410}
        onInteract={clock.pause}
      >
        <DocumentFrame
          title="Launch checklist"
          tags={['Launch']}
          status={
            <Show when={status()}>
              {(state) => (
                <Tooltip
                  as="span"
                  label={
                    state() === 'offline'
                      ? "You're offline. Changes will sync when you reconnect."
                      : 'Reconnecting…'
                  }
                >
                  <span
                    role="status"
                    aria-label={
                      state() === 'offline' ? 'Offline' : 'Reconnecting'
                    }
                    class="doc-sync-status"
                    data-status={state()}
                  >
                    <Show when={state() === 'offline'} fallback={<Cloud />}>
                      <CloudWarning />
                    </Show>
                  </span>
                </Tooltip>
              )}
            </Show>
          }
        >
          <h2>Final checks</h2>
          <ul class="md-list">
            <li>Check pricing on desktop and mobile.</li>
            <li>Test the signup links.</li>
          </ul>
          <h2>Announcement</h2>
          <p>
            <Show when={clock.t() >= 6000}>
              <span class="doc-story-merged">Julia has the email ready. </span>
            </Show>
            Send it tomorrow.
            {typed(' Add a screenshot of the new page.', clock.t(), 1000, 4200)}
            <Show when={clock.live() && clock.t() < 4800}>
              <Caret who="jacob" />
            </Show>
          </p>
        </DocumentFrame>
      </ProductDemo>
    </div>
  );
}
