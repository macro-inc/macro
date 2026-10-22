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
        title="Email and chat"
        description="Share live email threads in channels. Ask agents to draft from your emails, documents, and calls."
        links={[
          { href: '/email', label: 'Email' },
          { href: '/channels', label: 'Chat' },
        ]}
        preview="email"
      />
      <Tile
        id="documents"
        title="Documents and tasks"
        description="CRDT documents with live agent edits. Create tasks from messages and link them to the specification."
        links={[
          { href: '/documents', label: 'Docs' },
          { href: '/tasks', label: 'Tasks' },
        ]}
        preview="documents"
      />
      <Tile
        id="coding-agents"
        title="Coding agents"
        description="Use your coding agent subscriptions in channels. Read the diff and follow the task through to a pull request."
        links={[
          { href: '/agents', label: 'Agents' },
          { href: '/github', label: 'GitHub' },
        ]}
        preview="agents"
      />
      <Tile
        id="spreadsheet"
        title="Sheets and databases"
        description="Live collaboration with humans and agents. Import your Google Sheets and Notion databases."
        links={[{ href: '/demo', label: 'Explore the workspace' }]}
        preview="spreadsheet"
      />
      <Tile
        id="crm"
        title="CRM"
        description="Companies and contacts created from email. Agents update deal stages and draft customer follow-ups."
        links={[{ href: '/crm', label: 'CRM' }]}
        preview="crm"
      />
      <Tile
        id="calls"
        title="Calls and transcripts"
        description="Record and transcribe calls in Macro. Ask agents to create tasks and draft follow-ups from the transcript."
        links={[{ href: '/calls', label: 'Calls' }]}
        preview="calls"
      />
    </div>
  );
}
