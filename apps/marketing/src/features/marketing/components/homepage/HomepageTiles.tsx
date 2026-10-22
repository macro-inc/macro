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
      <div class="macro-tile-art">
        <DeferredDemo
          preload={loadPreview}
          fallback={<DemoPlaceholder label={`${props.title} preview`} />}
        >
          <ProductPreview kind={props.preview} />
        </DeferredDemo>
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
        title="Email tightly integrated with your team chat and tasks"
        description="Share a live email thread in a channel, work on the reply together, and create tasks from the conversation."
        links={[
          { href: '/email', label: 'Email' },
          { href: '/channels', label: 'Chat' },
        ]}
        preview="email"
      />
      <Tile
        id="documents"
        title="Documents your team and agents can edit together"
        description="Write with your teammates in the same document. Ask an agent to draft a section or update the plan using the context in your workspace."
        links={[{ href: '/documents', label: 'Docs' }]}
        preview="documents"
      />
      <Tile
        id="tasks"
        title="A task manager that keeps itself up to date"
        description="Keep tasks linked to the work. A pull request moves its task into review when it opens and marks it complete when it merges."
        links={[{ href: '/tasks', label: 'Tasks' }]}
        preview="tasks"
      />
      <Tile
        id="coding-agents"
        title="Assign agents tasks. Mention them in channels just like colleagues."
        description="Bring the agents you already use into Macro. Give them the context, let them do the work, and review their changes alongside the conversation."
        links={[
          { href: '/agents', label: 'Agents' },
          { href: '/github', label: 'GitHub' },
        ]}
        preview="agents"
      />
      <Tile
        id="spreadsheet"
        title="Organize with sheets and databases"
        description="Bring in your Google Sheets and Notion databases. Link records to emails, documents, and people, and edit them with teammates and agents."
        links={[{ href: '/demo', label: 'Explore the workspace' }]}
        preview="spreadsheet"
      />
      <Tile
        id="crm"
        title="Auto-updating, hands-free CRM"
        description="Macro creates companies and contacts from your email. Agents can update deal stages and draft follow-ups from the latest conversation."
        links={[{ href: '/crm', label: 'CRM' }]}
        preview="crm"
      />
      <Tile
        id="calls"
        title="Calls and transcripts"
        description="The decisions made on a call should be available afterward. Record and transcribe it, return to the relevant moment, and ask an agent to turn the next steps into tasks."
        links={[{ href: '/calls', label: 'Calls' }]}
        preview="calls"
      />
    </div>
  );
}
