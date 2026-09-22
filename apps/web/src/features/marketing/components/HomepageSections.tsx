import { type JSX, lazy, onCleanup, onMount, Show, Suspense } from 'solid-js';
import { DocsAgentTeammateGraphic } from '../../../../marketing/src/app/components/featureGraphics/DocumentsGraphics';
import { HomeIntroProof } from '../../../../marketing/src/app/components/sections/HomeIntroProof';
import siteStyles from '../../../../marketing/src/app/main/index.css?inline';
import {
  HomepageConversation,
  type HomepageMessage,
} from './HomepageConversation';
import { HomepageMention } from './HomepageMention';
import { HomepageVersionHistory } from './HomepageVersionHistory';
import './workspace-story.css';

const HomepageTaskConversation = lazy(
  () => import('./HomepageTaskConversation')
);
const HomepageEmailCompose = lazy(() => import('./HomepageEmailCompose'));
const HomepageCollaborativeDoc = lazy(
  () => import('./HomepageCollaborativeDoc')
);

const LaunchPlan = () => (
  <HomepageMention
    kind="md"
    label="Q3 launch plan"
    description="The shared launch plan, checklist, and owners. Julia and Gabriel are editing."
    href="#documents"
  />
);
const LaunchEmail = () => (
  <HomepageMention
    kind="email"
    label="Thursday’s launch"
    description="Jacob → Dana · Launch confirmed for Thursday at 9 AM. The plan will follow."
    href="#email"
  />
);

const definitions =
  siteStyles.match(/@(font-face|property)[^{]*\{[^}]*\}/g)?.join('\n') ?? '';
const scopedStyles = siteStyles
  .replace(/@(font-face|property)[^{]*\{[^}]*\}/g, '')
  .replaceAll(':root', ':scope');

function MarginNote(props: { children: JSX.Element }) {
  return (
    <aside
      class="homepage-feature-note workspace-demo"
      aria-label="About this feature"
    >
      <p class="homepage-enter">{props.children}</p>
    </aside>
  );
}

function Feature(props: {
  id: string;
  label: string;
  messages: readonly HomepageMessage[];
  children: JSX.Element;
  reply?: readonly HomepageMessage[];
  note?: string;
}) {
  return (
    <section class="homepage-feature" aria-label={props.label} id={props.id}>
      <HomepageConversation messages={props.messages} />
      <div class="homepage-feature-visual">
        <div
          class={`homepage-feature-graphic homepage-enter homepage-feature-${props.id}`}
        >
          {props.children}
        </div>
        <Show when={props.note}>
          {(note) => <MarginNote>{note()}</MarginNote>}
        </Show>
      </div>
      <div class="homepage-feature-reply">
        <HomepageConversation messages={props.reply ?? []} />
      </div>
    </section>
  );
}

export function HomepageSections() {
  let root!: HTMLDivElement;

  onMount(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const items = Array.from(
      root.querySelectorAll<HTMLElement>('.homepage-enter')
    );
    // Observe visibility only: no scroll listeners, pinned content, or layout
    // changes. Each message arrives once, and stays readable when scrolling back.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = 'visible';
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -32px 0px', threshold: 0.08 }
    );
    const showAll = () => {
      if (!reduced.matches) return;
      observer.disconnect();
      items.forEach((item) => {
        item.dataset.reveal = 'visible';
      });
    };
    for (const item of items) {
      item.dataset.reveal = reduced.matches ? 'visible' : 'waiting';
      if (!reduced.matches) observer.observe(item);
    }
    // Keyboard navigation must never land in a faded, pending example.
    const showFocused = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      const item = event.target.closest<HTMLElement>('.homepage-enter');
      if (item) {
        item.dataset.reveal = 'visible';
        observer.unobserve(item);
      }
    };
    root.addEventListener('focusin', showFocused);
    reduced.addEventListener('change', showAll);
    onCleanup(() => {
      observer.disconnect();
      root.removeEventListener('focusin', showFocused);
      reduced.removeEventListener('change', showAll);
    });
  });

  return (
    <div ref={root} class="homepage-sections">
      <style>{definitions}</style>
      <style>{`@scope (.homepage-sections) to (.workspace-demo) { ${scopedStyles} }`}</style>
      <div class="homepage-sections-inner">
        <div class="homepage-compact-proof">
          <HomeIntroProof />
        </div>
        <Feature
          id="email"
          label="Sending the launch email"
          note="A full email client, alongside your team’s conversations, documents, and tasks."
          messages={[
            {
              person: 'julia',
              text: 'Dana wants to invite her team. Are we still on for Thursday?',
            },
            {
              person: 'jacob',
              text: (
                <>
                  Yes. I’ll confirm the date, then we can put the plan together.
                </>
              ),
              reaction: { emoji: '👍', label: 'Thumbs up' },
            },
          ]}
        >
          <Suspense
            fallback={
              <div class="homepage-compose-loading">Opening draft…</div>
            }
          >
            <HomepageEmailCompose />
          </Suspense>
        </Feature>
        <Feature
          id="documents"
          label="Creating the shared launch plan"
          note="Macro docs are collaborative, agent native, backed by CRDTs, and have version control."
          messages={[
            {
              person: 'jacob',
              text: (
                <>
                  Let’s put the owners and checklist in <LaunchPlan />. Julia,
                  can you take the announcement? Gabriel, the invite check?
                </>
              ),
            },
            {
              person: 'julia',
              text: 'On it. I’m in the doc with Gabriel now.',
            },
          ]}
        >
          <Suspense
            fallback={
              <div class="homepage-compose-loading">
                Opening shared document…
              </div>
            }
          >
            <HomepageCollaborativeDoc />
          </Suspense>
        </Feature>
        <Feature
          id="agent-edits"
          label="Editing the plan together"
          note="People and agents edit the same document, using the conversation and linked sources as context."
          messages={[
            {
              person: 'julia',
              text: (
                <>
                  The old Friday date is still in <LaunchPlan />.{' '}
                  <span class="homepage-person-mention">@Claude</span>, use{' '}
                  <LaunchEmail /> to fix it. Keep our other edits.
                </>
              ),
            },
          ]}
          reply={[
            {
              person: 'claude',
              text: 'Changed Friday to Thursday, 9 AM, to match the email. Your announcement and Gabriel’s checklist are untouched.',
            },
          ]}
        >
          <DocsAgentTeammateGraphic launchReview />
        </Feature>
        <Feature
          id="version-control"
          label="Reviewing the document history"
          messages={[
            {
              person: 'jacob',
              text: (
                <>
                  Let me compare that with the previous version of{' '}
                  <LaunchPlan /> before we send it.
                </>
              ),
            },
          ]}
          reply={[
            {
              person: 'julia',
              text: 'Date looks right now. I’ll try the invite as a new teammate before Dana gets it.',
              reaction: { emoji: '👍', label: 'Thumbs up' },
            },
          ]}
        >
          <HomepageVersionHistory />
        </Feature>
        <section
          class="homepage-feature"
          id="tasks"
          aria-label="Turning the conversation into a task"
        >
          <div class="homepage-feature-visual">
            <div class="homepage-feature-graphic homepage-enter">
              <Suspense
                fallback={
                  <div class="homepage-compose-loading">Opening channel…</div>
                }
              >
                <HomepageTaskConversation />
              </Suspense>
            </div>
            <MarginNote>
              A message can become a task. The owner, checklist, and agent
              updates stay in the same conversation.
            </MarginNote>
          </div>
        </section>
        <div class="homepage-feature-end">
          <a class="glass" href="/start">
            Get started <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </div>
  );
}
