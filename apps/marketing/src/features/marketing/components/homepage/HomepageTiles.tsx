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
  detail: string;
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
        <p>{props.detail}</p>
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
        description="Share live email threads in channels. Ask agents to draft from your emails, documents, and calls."
        links={[
          { href: '/email', label: 'Email' },
          { href: '/channels', label: 'Chat' },
        ]}
        detail="The thread stays linked to the conversation. Your team can discuss the reply in the channel, and an agent can use the relevant documents and call transcript to draft it."
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
        detail="Keep the plan and its tasks linked. People and agents can edit the same document, and the team can return to the specification when it needs the details behind a task."
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
        detail="Give the agent a task in the channel where you’re already discussing it. Follow its work, inspect the changes, and review the pull request without losing the original conversation."
        preview="agents"
      />
      <Tile
        id="spreadsheet"
        title="Sheets and databases"
        description="Live collaboration with humans and agents. Import your Google Sheets and Notion databases."
        links={[{ href: '/demo', label: 'Explore the workspace' }]}
        detail="Link a customer in a sheet to their company record. Move from the row to the related email or contact without searching through another app."
        preview="spreadsheet"
      />
      <Tile
        id="crm"
        title="CRM"
        description="Companies and contacts created from email. Agents update deal stages and draft customer follow-ups."
        links={[{ href: '/crm', label: 'CRM' }]}
        detail="A call or an email contains the next step for a deal. Ask an agent to update the stage and prepare the follow-up from that conversation."
        preview="crm"
      />
      <Tile
        id="calls"
        title="Calls and transcripts"
        description="Record and transcribe calls in Macro. Ask agents to create tasks and draft follow-ups from the transcript."
        links={[{ href: '/calls', label: 'Calls' }]}
        detail="Return to a specific moment in the transcript when you need to check a decision. Use that same record to give an agent context for the work that follows."
        preview="calls"
      />
    </div>
  );
}
