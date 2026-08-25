import { Block, type BlockName } from '@core/block';
import { createSignal, Show } from 'solid-js';
import { CollabMdSurface } from '../CollabMdSurface';
import type { CollabSurfaceParent } from '../createCollabSurface';

/** The block type that hosts each parent entity type, for the demo's
 *  stand-in Block wrapper (in the app the hosting block already exists). */
const BLOCK_FOR_PARENT: Partial<
  Record<CollabSurfaceParent['entityType'], BlockName>
> = {
  document: 'md',
  channel: 'channel',
  project: 'project',
  chat: 'chat',
  email_thread: 'email',
  call: 'call',
};

type Mounted = {
  surfaceId: string;
  parent: CollabSurfaceParent;
  initialMarkdown: string;
};

/**
 * Dev-only playground for the collab-surface primitive
 * (`collab-surface-demo` in the split-component registry).
 *
 * The component derives its parent from the enclosing block, so this page
 * wraps it in a stand-in `<Block>` for the entity you name (a document you
 * own, a channel you're in). Enter a stable surface id — generate a fresh
 * one, or paste one from another window to join its session. Open the same
 * id in two windows and type in both.
 */
export default function CollabSurfaceDemoPage() {
  const [parentType, setParentType] =
    createSignal<CollabSurfaceParent['entityType']>('document');
  const [parentId, setParentId] = createSignal('');
  const [surfaceId, setSurfaceId] = createSignal<string>(crypto.randomUUID());
  const [seedMarkdown, setSeedMarkdown] = createSignal('# Hello surface');
  const [mounted, setMounted] = createSignal<Mounted>();

  const open = () => {
    setMounted(undefined);
    // Re-mount on next tick so opening the same id twice re-creates the session.
    queueMicrotask(() =>
      setMounted({
        surfaceId: surfaceId().trim(),
        parent: { entityType: parentType(), entityId: parentId().trim() },
        initialMarkdown: seedMarkdown(),
      })
    );
  };

  return (
    <div class="flex flex-col gap-4 p-6 max-w-2xl mx-auto overflow-y-auto">
      <h1 class="text-lg font-semibold">Collab surface demo</h1>

      <div class="flex flex-col gap-2 border border-ink/10 rounded p-4">
        <label class="flex items-center gap-2 text-sm">
          Parent type
          <select
            class="border border-ink/20 rounded px-2 py-1 bg-transparent"
            value={parentType()}
            onChange={(e) =>
              setParentType(
                e.currentTarget.value as CollabSurfaceParent['entityType']
              )
            }
          >
            <option value="document">document</option>
            <option value="channel">channel</option>
            <option value="project">project</option>
            <option value="chat">chat</option>
            <option value="email_thread">email_thread</option>
            <option value="call">call</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm">
          Parent id
          <input
            class="border border-ink/20 rounded px-2 py-1 grow bg-transparent font-mono"
            placeholder="uuid of an entity you can access"
            value={parentId()}
            onInput={(e) => setParentId(e.currentTarget.value)}
          />
        </label>
        <label class="flex items-center gap-2 text-sm">
          Surface id
          <input
            class="border border-ink/20 rounded px-2 py-1 grow bg-transparent font-mono"
            value={surfaceId()}
            onInput={(e) => setSurfaceId(e.currentTarget.value)}
          />
          <button
            type="button"
            class="border border-ink/20 rounded px-3 py-1 text-sm hover:bg-ink/5"
            onClick={() => setSurfaceId(crypto.randomUUID())}
          >
            Generate
          </button>
          <button
            type="button"
            class="border border-ink/20 rounded px-3 py-1 text-sm hover:bg-ink/5"
            onClick={() => navigator.clipboard.writeText(surfaceId())}
          >
            Copy
          </button>
        </label>
        <label class="flex items-center gap-2 text-sm">
          Seed markdown
          <input
            class="border border-ink/20 rounded px-2 py-1 grow bg-transparent font-mono"
            value={seedMarkdown()}
            onInput={(e) => setSeedMarkdown(e.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          class="self-start border border-ink/20 rounded px-3 py-1 text-sm hover:bg-ink/5 disabled:opacity-50"
          disabled={!parentId().trim() || !surfaceId().trim()}
          onClick={open}
        >
          Open (load or create)
        </button>
      </div>

      <Show when={mounted()} keyed>
        {(m) => (
          <div class="border border-ink/10 rounded p-4 min-h-64">
            <div class="text-xs text-ink-placeholder font-mono mb-2">
              {m.surfaceId}
            </div>
            <Block
              id={m.parent.entityId}
              name={BLOCK_FOR_PARENT[m.parent.entityType] ?? 'md'}
            >
              <CollabMdSurface
                surfaceId={m.surfaceId}
                initialMarkdown={m.initialMarkdown}
                placeholder="Type here…"
              />
            </Block>
          </div>
        )}
      </Show>
    </div>
  );
}
