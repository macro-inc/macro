import {
  createMemo,
  For,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import siteStyles from '../../../app/main/index.css?inline';
import { DeferredDemo, DemoPlaceholder } from './DeferredDemo';
import { DemoInteractionBoundary } from './DemoInteractionBoundary';
import { DemoMention } from './DemoMention';
import { HomepageAgentLogos } from './HomepageAgentLogos';
import { HomepageBlog } from './HomepageBlog';
import { HomepageClosing } from './HomepageClosing';
import {
  HomepageConversation,
  type HomepageMessage,
} from './HomepageConversation';
import {
  HomepageFeatureDetails,
  type ProductPagePath,
} from './HomepageFeatureDetails';
import { HomepageFeatureHeading } from './HomepageFeatureHeading';
import { HomepageMention } from './HomepageMention';
import { HomepageOpenSource } from './HomepageOpenSource';
import { HomepageSidebar } from './HomepageSidebar';
import { HomepageTestimonials } from './HomepageTestimonials';
import './workspace-story.css';

// Retain the standalone sidebar breakdown for future use.
const SHOW_SIDEBAR_BREAKDOWN = false;

const loadPullRequest = () => import('./HomepagePullRequest');
const loadEmailCompose = () => import('./HomepageEmailCompose');
const loadCollaborativeDoc = () => import('./HomepageCollaborativeDoc');
const loadCrm = () => import('./HomepageCrm');
const HomepageCrm = lazy(loadCrm);
const loadSpreadsheet = () => import('./HomepageSpreadsheet');

const HomepagePullRequest = lazy(loadPullRequest);
const HomepageEmailCompose = lazy(loadEmailCompose);
const HomepageCollaborativeDoc = lazy(loadCollaborativeDoc);
const HomepageSpreadsheet = lazy(loadSpreadsheet);

const LaunchPlan = () => (
  <HomepageMention
    kind="md"
    label="Website launch plan"
    description="The shared launch plan, checklist, and owners. Julia and Gabriel are editing."
    href="#documents"
  />
);

const CustomersSheet = () => (
  <HomepageMention
    kind="spreadsheet"
    label="Customers to reach"
    description="Top customers this month, compiled from PostHog. The list stays in the spreadsheet."
    href="#spreadsheet"
  />
);

const definitions =
  siteStyles.match(/@(font-face|property)[^{]*\{[^}]*\}/g)?.join('\n') ?? '';
const scopedStyles = siteStyles
  .replace(/@(font-face|property)[^{]*\{[^}]*\}/g, '')
  .replaceAll(':root', ':scope');

function Feature(props: {
  id: string;
  title: string;
  description: string;
  productPages?: readonly { title: string; path: ProductPagePath }[];
  titleAdornment?: JSX.Element;
  messages?: readonly HomepageMessage[];
  children?: JSX.Element;
  render?: () => JSX.Element;
}) {
  const conversation = createMemo(() => props.messages);
  return (
    <section
      class="homepage-feature"
      aria-labelledby={`${props.id}-title`}
      id={props.id}
    >
      <HomepageFeatureHeading
        id={`${props.id}-title`}
        title={props.title}
        description={props.description}
      >
        {props.titleAdornment}
      </HomepageFeatureHeading>
      <Show when={conversation()}>
        {(messages) => <HomepageConversation messages={messages()} />}
      </Show>
      <DemoInteractionBoundary
        label={props.title}
        class="homepage-feature-visual"
        render={() => (
          <div
            class={`homepage-feature-graphic homepage-enter homepage-feature-${props.id}`}
          >
            {props.render ? props.render() : props.children}
          </div>
        )}
      />
      <Show when={props.productPages}>
        {(pages) => (
          <div class="homepage-feature-more-group">
            <span class="homepage-feature-more-label">Learn more</span>
            <For each={pages()}>
              {(page) => (
                <HomepageFeatureDetails title={page.title} path={page.path} />
              )}
            </For>
          </div>
        )}
      </Show>
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
        <HomepageOpenSource showSidebarBreakdown={SHOW_SIDEBAR_BREAKDOWN}>
          <HomepageSidebar showInteractiveDemo={false} />
        </HomepageOpenSource>
        <Feature
          id="email"
          productPages={[
            { title: 'Email', path: '/email' },
            { title: 'Chat', path: '/channels' },
          ]}
          title="Email and chat"
          description="Share live email threads in channels. Ask agents to draft from your emails, documents, and calls."
          messages={[
            {
              person: 'julia',
              text: 'Can you send Valentina the demo follow-up?',
            },
            {
              person: 'jacob',
              text: (
                <>
                  <DemoMention
                    item={{ id: 'macro', label: 'Macro', kind: 'person' }}
                  />{' '}
                  draft Valentina’s follow-up from{' '}
                  <HomepageMention
                    kind="call"
                    label="Demo call transcript"
                    description="Transcript of the September 14 demo with Valentina · Team rollout, sales materials, and follow-up next steps."
                    href="#email"
                  />
                  . Link the sales PDF and rollout plan. Cc Julia.
                </>
              ),
            },
          ]}
          render={() => (
            <DeferredDemo
              preload={loadEmailCompose}
              fallback={<DemoPlaceholder label="Email draft preview" />}
            >
              <HomepageEmailCompose />
            </DeferredDemo>
          )}
        />
        <Feature
          id="documents"
          productPages={[
            { title: 'Documents', path: '/documents' },
            { title: 'Tasks', path: '/tasks' },
          ]}
          title="Documents and tasks"
          description="CRDT documents with live agent edits. Create tasks from messages and link them to the specification."
          messages={[
            {
              person: 'jacob',
              text: (
                <>
                  Let’s put the plan, owners, and tasks in <LaunchPlan />.
                  Julia, can you take the announcement? Gabriel, the invite
                  check?
                </>
              ),
            },
            {
              person: 'julia',
              text: 'On it. I’ve linked the launch checklist so we can track it from the doc.',
            },
          ]}
          render={() => (
            <figure class="homepage-doc-history" id="tasks">
              <div id="version-control">
                <DeferredDemo
                  preload={loadCollaborativeDoc}
                  fallback={
                    <DemoPlaceholder label="Collaborative document, tasks, and version history preview" />
                  }
                >
                  <HomepageCollaborativeDoc />
                </DeferredDemo>
              </div>
            </figure>
          )}
        />
        <Feature
          id="coding-agents"
          productPages={[{ title: 'Agents', path: '/agents' }]}
          title="Coding agents"
          titleAdornment={<HomepageAgentLogos />}
          description="Use your coding agent subscriptions in channels. Read the diff and follow the task through to a pull request."
          render={() => (
            <DeferredDemo
              preload={loadPullRequest}
              fallback={<DemoPlaceholder label="Agent session preview" />}
            >
              <HomepagePullRequest />
            </DeferredDemo>
          )}
        />
        <Feature
          id="spreadsheet"
          title="Sheets and databases"
          description="Live collaboration with humans and agents. Import your Google Sheets and Notion databases."
          messages={[
            {
              person: 'claude',
              text: (
                <>
                  Checked PostHog. The most active accounts this month are in{' '}
                  <CustomersSheet />.
                </>
              ),
            },
          ]}
          render={() => (
            <DeferredDemo
              preload={loadSpreadsheet}
              fallback={<DemoPlaceholder label="Spreadsheet preview" />}
            >
              <HomepageSpreadsheet />
            </DeferredDemo>
          )}
        />
        <Feature
          id="crm"
          productPages={[{ title: 'CRM', path: '/crm' }]}
          title="CRM"
          description="Companies and contacts created from email. Agents update deal stages and draft customer follow-ups."
          messages={[
            {
              person: 'jacob',
              text: (
                <>
                  <span class="homepage-person-mention">@Claude</span>, update
                  the CRM from{' '}
                  <HomepageMention
                    kind="call"
                    label="Sales sync"
                    description="Today’s sales call · Keystone Mechanical asked for a proposal, and Bookend Retail signed."
                    href="#crm"
                  />
                  . Keystone Mechanical asked for a proposal, and Bookend Retail
                  signed. Update their stages.
                </>
              ),
            },
          ]}
          render={() => (
            <DeferredDemo
              preload={loadCrm}
              fallback={<DemoPlaceholder label="CRM pipeline preview" />}
            >
              <HomepageCrm />
            </DeferredDemo>
          )}
        />
        <HomepageTestimonials />
        <HomepageBlog />
        <HomepageClosing root={() => root} />
      </div>
    </div>
  );
}
