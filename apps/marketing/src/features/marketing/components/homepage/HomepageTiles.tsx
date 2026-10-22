import Arrow from '@phosphor/arrow-up-right.svg';
import { createUniqueId, For, lazy } from 'solid-js';
import { WorkspaceTexture } from '../../../setup/components/WorkspaceTexture';
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
  const textureId = createUniqueId();
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
        <div class="macro-tile-ambience" aria-hidden="true">
          <WorkspaceTexture accent="var(--feature-glow)" filterId={textureId} />
        </div>
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

export function HomepageFeatureToc(props: { mobile?: boolean }) {
  return (
    <aside
      class={`macro-feature-toc ${props.mobile ? 'macro-feature-toc-mobile' : 'macro-feature-toc-desktop'}`}
    >
      <nav aria-label="Key features">
        <span>Features</span>
        <For
          each={[
            { id: 'email', label: 'Email' },
            { id: 'chat', label: 'Chat' },
            { id: 'documents', label: 'Documents' },
            { id: 'tasks', label: 'Tasks' },
            { id: 'coding-agents', label: 'Agents' },
            { id: 'spreadsheet', label: 'Sheets' },
            { id: 'databases', label: 'Databases' },
            { id: 'crm', label: 'CRM' },
            { id: 'calls', label: 'Calls' },
          ]}
        >
          {(feature) => <a href={`#${feature.id}`}>{feature.label}</a>}
        </For>
      </nav>
    </aside>
  );
}

/** The same product UI used by the detailed demos, framed as compact previews. */
export function HomepageTiles() {
  return (
    <div class="macro-feature-layout">
      <HomepageFeatureToc mobile />
      <div class="macro-feature-grid">
        <Tile
          id="email"
          title="Email tightly integrated with your team chat and tasks"
          description="Share the actual email in a channel. Your team sees the whole thread, including replies that arrive later. Discuss it, draft a response, or create a task without copying the conversation into another app."
          links={[{ href: '/email', label: 'Email' }]}
          preview="email"
        />
        <Tile
          id="chat"
          title="Team chat with the work right there"
          description="Share emails, documents, and tasks in a channel. Your team can open the original, reply in a thread, and mention an agent when they need a hand. The conversation stays with the work."
          links={[{ href: '/channels', label: 'Chat' }]}
          preview="chat"
        />
        <Tile
          id="documents"
          title="Documents your team and agents can edit together"
          description="We wanted the simplicity of Markdown without giving up live collaboration. People and agents can write in the same document, with live cursors. Mention the email or task you’re writing about. Keep editing if your connection drops."
          links={[{ href: '/documents', label: 'Docs' }]}
          preview="documents"
        />
        <Tile
          id="tasks"
          title="A task manager that keeps itself up to date"
          description="Create a task from the message, email, or checklist where the work came up. The source stays linked in both directions. Agents can handle updates, and linked pull requests move tasks into review and mark them complete when merged."
          links={[{ href: '/tasks', label: 'Tasks' }]}
          preview="tasks"
        />
        <Tile
          id="coding-agents"
          title="Assign agents tasks. Mention them in channels just like colleagues."
          description="An agent should know what your team is working on, not just what you told it in a chat. Macro’s shared memory brings together email, docs, tasks, channels, and calls. Choose a model or bring your own agent, then put it to work."
          links={[
            { href: '/agents', label: 'Agents' },
            { href: '/github', label: 'GitHub' },
          ]}
          preview="agents"
        />
        <Tile
          id="spreadsheet"
          title="Sheets your team can work in together"
          description="Bring in your Google Sheets and work on them with your team and agents. Link cells to people, companies, and documents, so the numbers stay connected to the work behind them."
          links={[{ href: '/demo', label: 'Explore the workspace' }]}
          preview="spreadsheet"
        />
        <Tile
          id="databases"
          title="Organize your work in databases"
          description="Track projects, customers, or whatever your team needs. Add your own fields, filter and sort the records, and update them together. Each record has a place for the details."
          links={[{ href: '/demo', label: 'Explore the workspace' }]}
          preview="databases"
        />
        <Tile
          id="crm"
          title="Auto-updating, hands-free CRM"
          description="A CRM is useful when it’s up to date. Keeping it that way shouldn’t be another job. Macro creates records from your team’s email and enriches them with public information. Agents can update the deal and draft the follow-up, right beside the conversation."
          links={[{ href: '/crm', label: 'CRM' }]}
          preview="crm"
        />
        <Tile
          id="calls"
          title="Calls and transcripts"
          description="Important decisions happen on calls. Your agents should be able to use them. Start a call from a channel or send a meeting link. Macro records and transcribes it, so you can revisit what was said and ask an agent to handle the follow-up."
          links={[{ href: '/calls', label: 'Calls' }]}
          preview="calls"
        />
      </div>
    </div>
  );
}
