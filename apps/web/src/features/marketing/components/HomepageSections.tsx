import { type JSX, lazy, onCleanup, onMount, Show } from 'solid-js';
import siteStyles from '../../../../marketing/src/app/main/index.css?inline';
import { animateHomepageCta } from './animateHomepageCta';
import { DeferredDemo, DemoPlaceholder } from './DeferredDemo';
import { HomepageAgentLogos } from './HomepageAgentLogos';
import { HomepageBlog } from './HomepageBlog';
import {
  HomepageConversation,
  type HomepageMessage,
} from './HomepageConversation';
import { HomepageFeatureHeading } from './HomepageFeatureHeading';
import { HomepageMention } from './HomepageMention';
import { HomepageOpenSource } from './HomepageOpenSource';
import { HomepageReassurance } from './HomepageReassurance';
import { HomepageSidebar } from './HomepageSidebar';
import { HomepageTestimonials } from './HomepageTestimonials';
import './workspace-story.css';

const loadVersionHistory = () =>
  import('./HomepageVersionHistory').then((module) => ({
    default: module.HomepageVersionHistory,
  }));
const loadPullRequest = () => import('./HomepagePullRequest');
const loadEmailCompose = () => import('./HomepageEmailCompose');
const loadCollaborativeDoc = () => import('./HomepageCollaborativeDoc');
const loadCrm = () => import('./HomepageCrm');
const HomepageCrm = lazy(loadCrm);
const loadSpreadsheet = () => import('./HomepageSpreadsheet');

const HomepageVersionHistory = lazy(loadVersionHistory);
const HomepagePullRequest = lazy(loadPullRequest);
const HomepageEmailCompose = lazy(loadEmailCompose);
const HomepageCollaborativeDoc = lazy(loadCollaborativeDoc);
const HomepageSpreadsheet = lazy(loadSpreadsheet);

const LaunchPlan = () => (
  <HomepageMention
    kind="md"
    label="Q3 launch plan"
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
  eyebrow?: JSX.Element;
  messages?: readonly HomepageMessage[];
  children: JSX.Element;
}) {
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
        {props.eyebrow}
      </HomepageFeatureHeading>
      <Show when={props.messages}>
        {(messages) => <HomepageConversation messages={messages()} />}
      </Show>
      <div class="homepage-feature-visual">
        <div
          class={`homepage-feature-graphic homepage-enter homepage-feature-${props.id}`}
        >
          {props.children}
        </div>
      </div>
    </section>
  );
}

export function HomepageSections() {
  let root!: HTMLDivElement;
  let appDestination!: HTMLDivElement;

  onMount(() => {
    onCleanup(animateHomepageCta(root, appDestination));
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
        <HomepageOpenSource>
          <HomepageSidebar />
        </HomepageOpenSource>
        <Feature
          id="email"
          title="Email and chat"
          description="A full email client, alongside your team’s conversations, documents, and tasks."
          messages={[
            {
              person: 'julia',
              text: 'Dana wants to invite her team. Are we still on for Thursday?',
            },
            {
              person: 'jacob',
              text: (
                <>
                  <span class="homepage-person-mention">@Claude</span>, draft a
                  follow-up email based on{' '}
                  <HomepageMention
                    kind="calendar"
                    label="Demo Call Sep 14th"
                    description="Jacob, Dana, and Julia · Product demo and next steps for Dana’s team."
                    href="#email"
                  />{' '}
                  and{' '}
                  <HomepageMention
                    kind="call"
                    label="Demo call transcript"
                    description="Transcript of the September 14 demo with Dana · Team rollout, sales materials, and follow-up next steps."
                    href="#email"
                  />
                  . Include the sales PDF and rollout doc, and cc Julia.
                </>
              ),
            },
          ]}
        >
          <DeferredDemo
            preload={loadEmailCompose}
            fallback={<DemoPlaceholder label="Email draft preview" />}
          >
            <HomepageEmailCompose />
          </DeferredDemo>
        </Feature>
        <Feature
          id="documents"
          title="Documents and tasks"
          description="Write together, assign tasks, and link the context behind your work. Keep the plan and the work to ship it in one place."
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
        >
          <div id="tasks">
            <DeferredDemo
              preload={loadCollaborativeDoc}
              fallback={
                <DemoPlaceholder label="Collaborative document and tasks preview" />
              }
            >
              <HomepageCollaborativeDoc />
            </DeferredDemo>
          </div>
          <figure class="homepage-doc-history" id="version-control">
            <figcaption>
              <span>Every edit has a history.</span>
              Compare changes and revisit earlier versions, whether the edits
              came from a teammate or an agent.
            </figcaption>
            <DeferredDemo
              preload={loadVersionHistory}
              fallback={
                <DemoPlaceholder label="Document version history preview" />
              }
            >
              <HomepageVersionHistory />
            </DeferredDemo>
          </figure>
        </Feature>
        <Feature
          id="coding-agents"
          title="Agents and pull requests"
          eyebrow={<HomepageAgentLogos />}
          description="Bring your existing agent subs into channels and see the full agent trace inline through to PR."
        >
          <DeferredDemo
            preload={loadPullRequest}
            fallback={<DemoPlaceholder label="Agent session preview" />}
          >
            <HomepagePullRequest />
          </DeferredDemo>
        </Feature>
        <Feature
          id="spreadsheet"
          title="Sheets and databases"
          description="Live collaboration with humans and agents. Import your Google Sheets and Notion databases."
          messages={[
            {
              person: 'gabriel',
              text: (
                <>
                  We should reach out personally to the people who already use
                  Macro. <span class="homepage-person-mention">@Claude</span>,
                  check PostHog and compile our top customers.
                </>
              ),
            },
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
        >
          <DeferredDemo
            preload={loadSpreadsheet}
            fallback={<DemoPlaceholder label="Spreadsheet preview" />}
          >
            <HomepageSpreadsheet />
          </DeferredDemo>
        </Feature>
        <Feature
          id="crm"
          title="Sales and marketing"
          description="CRM, outbound, and marketing automation. Connected across the customer lifecycle."
          messages={[
            {
              person: 'valentina',
              text: (
                <>
                  <span class="homepage-person-mention">@Claude</span>, update
                  the CRM from{' '}
                  <HomepageMention
                    kind="call"
                    label="Sales sync"
                    description="Today’s sales call · Northwind requested a proposal, and Lumen signed."
                    href="#crm"
                  />
                  . Northwind asked for a proposal, and Lumen signed. Move them
                  to the right stages.
                </>
              ),
            },
          ]}
        >
          <DeferredDemo
            preload={loadCrm}
            fallback={<DemoPlaceholder label="CRM pipeline preview" />}
          >
            <HomepageCrm />
          </DeferredDemo>
        </Feature>
        <HomepageTestimonials />
        <HomepageBlog />
        <footer class="homepage-feature-end workspace-demo">
          <hr class="homepage-closing-rule" />
          <div
            ref={appDestination}
            class="homepage-app-landing"
            aria-hidden="true"
          />
          <HomepageReassurance />
        </footer>
      </div>
    </div>
  );
}
