import Arrow from '@phosphor/arrow-up-right.svg';
import { For, lazy } from 'solid-js';
import { DeferredDemo, DemoPlaceholder } from '../DeferredDemo';
import type { HomepagePreviewKind } from './HomepageProductPreview';

const loadPreview = () => import('./HomepageProductPreview');
const ProductPreview = lazy(loadPreview);

function Tile(props: {
  id: string;
  title: string;
  description: string;
  links: { href: string; label: string }[];
  preview: HomepagePreviewKind;
}) {
  return (
    <section
      class={`macro-feature-tile macro-tile-${props.id}`}
      id={props.id}
      aria-labelledby={`${props.id}-title`}
    >
      <div class="macro-tile-art">
        <DeferredDemo
          preload={loadPreview}
          fallback={<DemoPlaceholder label={`${props.title} preview`} />}
        >
          <ProductPreview kind={props.preview} />
        </DeferredDemo>
      </div>
      <div class="macro-tile-copy">
        <h2 id={`${props.id}-title`}>{props.title}</h2>
        <p>{props.description}</p>
        <div class="macro-tile-links">
          <For each={props.links}>
            {(link) => (
              <a href={link.href}>
                {link.label}
                <Arrow aria-hidden="true" />
              </a>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}

/** The same product UI used by the detailed demos, framed as compact previews. */
export function HomepageTiles() {
  return (
    <div class="macro-feature-grid">
      <Tile
        id="email"
        title="Good conversations. Less back-and-forth."
        description="Email and team chat, connected. Share a live email thread in a channel and work on the reply together."
        links={[
          { href: '/email', label: 'Email' },
          { href: '/channels', label: 'Chat' },
        ]}
        preview="email"
      />
      <Tile
        id="documents"
        title="From the first thought to the final done."
        description="Write together in live documents. Turn messages into tasks, link the plan, and keep everyone on the same page."
        links={[
          { href: '/documents', label: 'Docs' },
          { href: '/tasks', label: 'Tasks' },
        ]}
        preview="documents"
      />
      <Tile
        id="coding-agents"
        title="A helping hand. With the whole picture."
        description="Bring your agents into the conversation. They can read your work, edit documents, and take a task through to a pull request."
        links={[
          { href: '/agents', label: 'Agents' },
          { href: '/github', label: 'GitHub' },
        ]}
        preview="agents"
      />
      <Tile
        id="spreadsheet"
        title="Everything adds up. Together."
        description="Sheets and databases your whole team can work in. Bring in your Google Sheets and let agents help with the next step."
        links={[{ href: '/demo', label: 'Explore the workspace' }]}
        preview="spreadsheet"
      />
      <Tile
        id="crm"
        title="A little more personal. A lot less admin."
        description="A CRM built from your email. Keep companies, contacts, and conversations connected, with agents to help with the follow-up."
        links={[{ href: '/crm', label: 'CRM' }]}
        preview="crm"
      />
      <Tile
        id="calls"
        title="Be in the conversation. Keep every detail."
        description="Calls, transcripts, and calendar in your workspace. Ask an agent to turn the conversation into a plan and a follow-up."
        links={[{ href: '/calls', label: 'Calls' }]}
        preview="calls"
      />
    </div>
  );
}
