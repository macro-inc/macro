import Arrow from '@icon/system/regular/arrow-up-right.svg';
import { For, lazy } from 'solid-js';
import { DeferredDemo, DemoPlaceholder } from '../DeferredDemo';
import { FeatureDemoBackdrop } from '../FeatureDemoBackdrop';
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
        <FeatureDemoBackdrop />
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
    <div class="macro-feature-layout">
      <div class="macro-feature-grid">
        <Tile
          id="email"
          title="Brilliantly fast email"
          description="Read, reply, and triage with keyboard shortcuts. Ask an agent to draft from your docs and calls, or share a live email thread with your team."
          links={[{ href: '/email', label: 'Email' }]}
          preview="email"
        />
        <Tile
          id="chat"
          title="Focused team chat with agents"
          description="Share emails, docs, and tasks in a channel, and discuss them in threads. Mention an agent just like a teammate."
          links={[{ href: '/channels', label: 'Chat' }]}
          preview="chat"
        />
        <Tile
          id="documents"
          title="Lightweight markdown docs"
          description="Write in plain Markdown with your team and agents editing the same document. Mention a customer email, task, or call, and keep writing if you go offline."
          links={[{ href: '/documents', label: 'Docs' }]}
          preview="documents"
        />
        <Tile
          id="tasks"
          title="Automatic task management"
          description="Create tasks from messages, emails, or docs. Agents keep them up to date, and linked pull requests move them into review and mark them done."
          links={[{ href: '/tasks', label: 'Tasks' }]}
          preview="tasks"
        />
        <Tile
          id="coding-agents"
          title="Bring your favorite agents"
          description="Use the models and coding agents you already like. Assign them tasks or mention them in channels, with memory from your team’s work."
          links={[
            { href: '/agents', label: 'Agents' },
            { href: '/github', label: 'GitHub' },
          ]}
          preview="agents"
        />
        <Tile
          id="spreadsheet"
          title="Link work together with sheets"
          description="Edit spreadsheets with your team and agents. Mention people and docs in cells, or ask an agent to calculate something and build a chart."
          links={[{ href: '/demo', label: 'Explore the workspace' }]}
          preview="spreadsheet"
        />
        <Tile
          id="databases"
          title="Migrate your Notion databases"
          description="Bring your Notion databases into Macro. Add custom fields and views, and link records to the emails, tasks, and docs they refer to."
          links={[{ href: '/demo', label: 'Explore the workspace' }]}
          preview="databases"
        />
        <Tile
          id="crm"
          title="Auto-updating, hands-free CRM"
          description="Macro builds customer records from your team’s email and enriches them with public information. Agents can update deals and draft follow-ups from the conversation."
          links={[{ href: '/crm', label: 'CRM' }]}
          preview="crm"
        />
        <Tile
          id="calls"
          title="Team-level memory for calls"
          description="Record and transcribe your team’s calls. Your agents can use what was discussed to update docs, create tasks, and draft follow-ups."
          links={[{ href: '/calls', label: 'Calls' }]}
          preview="calls"
        />
      </div>
    </div>
  );
}
