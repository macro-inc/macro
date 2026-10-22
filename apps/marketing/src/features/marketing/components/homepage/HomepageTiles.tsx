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
        title="Email and chat"
        description="We put email and team chat together so you can discuss a customer’s message with your team without forwarding copies around. Share the live thread in a channel and work on the reply there."
        links={[
          { href: '/email', label: 'Email' },
          { href: '/channels', label: 'Chat' },
        ]}
        preview="email"
      />
      <Tile
        id="documents"
        title="Documents and tasks"
        description="A task should carry the reason it exists. Create one from a message or document, keep the source linked, and edit the plan together as the work changes."
        links={[
          { href: '/documents', label: 'Docs' },
          { href: '/tasks', label: 'Tasks' },
        ]}
        preview="documents"
      />
      <Tile
        id="coding-agents"
        title="Coding agents"
        description="We want you to use the coding agents you already pay for. Bring them into a channel, give them a task, and review the diff and pull request alongside the conversation."
        links={[
          { href: '/agents', label: 'Agents' },
          { href: '/github', label: 'GitHub' },
        ]}
        preview="agents"
      />
      <Tile
        id="spreadsheet"
        title="Sheets and databases"
        description="Some work belongs in rows and columns. Bring in your Google Sheets and Notion databases, link records to the rest of your work, and edit them with teammates and agents."
        links={[{ href: '/demo', label: 'Explore the workspace' }]}
        preview="spreadsheet"
      />
      <Tile
        id="crm"
        title="CRM"
        description="Keeping a CRM current shouldn’t be a second job. Macro creates companies and contacts from email; agents can update deal stages and draft the next follow-up."
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
