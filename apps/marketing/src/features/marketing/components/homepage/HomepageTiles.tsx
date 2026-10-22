import Arrow from '@phosphor/arrow-up-right.svg';
import {
  createSignal,
  createUniqueId,
  For,
  lazy,
  onCleanup,
  onMount,
} from 'solid-js';
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

function HomepageFeatureToc(props: { active?: string }) {
  return (
    <aside class="macro-feature-toc">
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
          {(feature) => (
            <a
              href={`#${feature.id}`}
              aria-current={
                props.active === feature.id ? 'location' : undefined
              }
            >
              {feature.label}
            </a>
          )}
        </For>
      </nav>
    </aside>
  );
}

/** The same product UI used by the detailed demos, framed as compact previews. */
export function HomepageTiles() {
  let layout!: HTMLDivElement;
  const [active, setActive] = createSignal<string>();
  onMount(() => {
    const scrollRoot = layout.closest<HTMLElement>('.macro-home-scroll');
    if (!scrollRoot) return;
    const sections = [
      ...layout.querySelectorAll<HTMLElement>('.macro-feature-tile'),
    ];
    let frame = 0;
    const update = () => {
      frame = 0;
      // Follow the section at the reading line below the fixed site header.
      const line = scrollRoot.getBoundingClientRect().top + 112;
      let current: string | undefined;
      for (const section of sections) {
        const rect = section.getBoundingClientRect();
        if (rect.top > line) break;
        current = section.id;
      }
      const last = sections[sections.length - 1];
      if (last && last.getBoundingClientRect().bottom <= line)
        current = undefined;
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    scrollRoot.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(scrollRoot);
    for (const section of sections) resize.observe(section);
    update();
    onCleanup(() => {
      scrollRoot.removeEventListener('scroll', schedule);
      resize.disconnect();
      cancelAnimationFrame(frame);
    });
  });
  return (
    <div class="macro-feature-layout" ref={layout}>
      <HomepageFeatureToc active={active()} />
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
          description="Keep conversations in channels, with threaded replies and the actual emails, docs, and tasks attached. Mention an agent just like a teammate."
          links={[{ href: '/channels', label: 'Chat' }]}
          preview="chat"
        />
        <Tile
          id="documents"
          title="Lightweight markdown docs"
          description="Write in Markdown with your team and agents, in the same document. Link to the work you’re writing about and keep editing offline."
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
          description="Use the models and coding agents you already like. Give them tasks or mention them in channels, with access to your team’s shared context."
          links={[
            { href: '/agents', label: 'Agents' },
            { href: '/github', label: 'GitHub' },
          ]}
          preview="agents"
        />
        <Tile
          id="spreadsheet"
          title="Link work together with sheets"
          description="Bring in your Google Sheets and edit them with your team and agents. Cells can link directly to people, companies, and docs."
          links={[{ href: '/demo', label: 'Explore the workspace' }]}
          preview="spreadsheet"
        />
        <Tile
          id="databases"
          title="Migrate your Notion databases"
          description="Bring your Notion databases into Macro. Keep your records alongside the conversations and documents they’re about."
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
