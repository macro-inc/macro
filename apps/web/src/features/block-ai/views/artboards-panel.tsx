/**
 * The Artboards panel: the document's artboards in order; a click chooses
 * one and fits it in the window, a double-click renames it, and editors
 * add (beside the last) and delete them.
 */

import { isCommitKey } from '@app/features/block-fig/core/shortcuts';
import FrameCorners from '@phosphor/frame-corners.svg';
import Plus from '@phosphor/plus.svg';
import Trash from '@phosphor/trash.svg';
import { Button } from '@ui/components/Button';
import { createSignal, For, Show } from 'solid-js';
import { toRect } from '../core/geometry';
import type { AiEditor } from '../primitives/create-ai-editor';
import type { AiViewer } from '../primitives/create-ai-viewer';

/** Space between a new artboard and the one before it (points). */
const GAP = 50;

export function ArtboardsPanel(props: { viewer: AiViewer; editor: AiEditor }) {
  const viewer = props.viewer;
  const editor = props.editor;
  const [renaming, setRenaming] = createSignal<number>();

  const choose = (id: number) => {
    viewer.setArtboard(id);
    viewer.fitArtboard(id);
  };

  const rename = (id: number, old: string, name: string | undefined) => {
    setRenaming(undefined);
    const trimmed = name?.trim();
    if (!trimmed || trimmed === old) return;
    void editor.renameArtboard(id, trimmed);
  };

  /** A new artboard the size of the last, to its right. */
  const add = () => {
    const list = viewer.artboards();
    const last = list[list.length - 1];
    const r = last ? toRect(last.rect) : { x: 0, y: 0, w: 1920, h: 1080 };
    const right = Math.max(...list.map((a) => a.rect.x1), r.x + r.w);
    void editor.newArtboard({ x: right + GAP, y: r.y, w: r.w, h: r.h });
  };

  return (
    <div
      class="flex size-full min-h-0 flex-col text-ink text-xs"
      data-testid="ai-artboards-panel"
    >
      <div class="flex h-8 shrink-0 items-center gap-1 border-edge-muted border-b px-2">
        <span class="flex-1 text-ink-muted">
          {viewer.artboards().length} artboards
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          label="New artboard"
          tooltip="New artboard"
          data-testid="ai-artboard-new"
          disabled={!editor.enabled()}
          onClick={add}
        >
          <Plus />
        </Button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <For each={viewer.artboards()}>
          {(a, index) => (
            <div
              class="group flex h-7 items-center gap-2 px-2 hover:bg-hover"
              classList={{ 'bg-accent/20': viewer.artboard() === a.id }}
              data-testid="ai-artboard-row"
              data-artboard-id={a.id}
            >
              <span class="w-5 shrink-0 text-right text-ink-muted tabular-nums">
                {index() + 1}
              </span>
              <FrameCorners class="size-3.5 shrink-0 text-ink-muted" />
              <Show
                when={renaming() === a.id}
                fallback={
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left"
                    onClick={() => choose(a.id)}
                    onDblClick={() => {
                      if (editor.enabled()) setRenaming(a.id);
                    }}
                  >
                    {a.name}
                  </button>
                }
              >
                <input
                  ref={(el) => queueMicrotask(() => el.select())}
                  class="min-w-0 flex-1 rounded-sm bg-input px-1 text-ink outline outline-1 outline-accent"
                  data-testid="ai-artboard-rename"
                  value={a.name}
                  onBlur={(e) => rename(a.id, a.name, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (isCommitKey(e)) e.currentTarget.blur();
                    if (e.key === 'Escape') setRenaming(undefined);
                  }}
                />
              </Show>
              <span class="shrink-0 text-ink-muted tabular-nums">
                {Math.round(a.rect.x1 - a.rect.x0)} ×{' '}
                {Math.round(a.rect.y1 - a.rect.y0)}
              </span>
              <Show when={editor.enabled() && viewer.artboards().length > 1}>
                <button
                  type="button"
                  aria-label={`Delete ${a.name}`}
                  data-testid="ai-artboard-delete"
                  class="invisible rounded p-0.5 text-ink-muted hover:text-ink group-hover:visible"
                  onClick={() => void editor.deleteArtboard(a.id)}
                >
                  <Trash class="size-3" />
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
