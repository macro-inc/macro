/**
 * Figma's "Library updates available" notice and its review dialog: each
 * changed component, style, or variable with its library, this file's copy
 * beside the newly published version, and Update for one or all.
 * Presentational: previews and updates come from the caller.
 */

import ArrowRight from '@phosphor/arrow-right.svg';
import BookOpen from '@phosphor/book-open.svg';
import XIcon from '@phosphor/x.svg';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { type LibraryUpdate, updateSummary } from '../core/libraries';
import { AssetThumbnail } from './asset-thumbnail';

export function LibraryUpdatesNotice(props: {
  updates: readonly LibraryUpdate[];
  onReview: () => void;
}) {
  const [dismissed, setDismissed] = createSignal(false);
  return (
    <Show when={!dismissed()}>
      <div
        class="absolute bottom-14 left-3 z-30 flex w-64 flex-col gap-1.5 rounded-xl border border-edge-muted bg-menu p-3 text-xs shadow-xl"
        data-testid="fig-library-updates"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div class="flex items-center gap-1.5 font-semibold text-ink">
          <BookOpen class="size-3.5 shrink-0 text-accent" />
          <span class="flex-1">Library updates available</span>
          <button
            type="button"
            aria-label="Dismiss"
            class="rounded p-0.5 text-ink-muted hover:text-ink"
            onClick={() => setDismissed(true)}
          >
            <XIcon class="size-3" />
          </button>
        </div>
        <p class="text-ink-muted">{updateSummary(props.updates)}</p>
        <Button
          variant="outline"
          size="sm"
          class="self-start"
          data-testid="fig-library-updates-review"
          onClick={() => props.onReview()}
        >
          Review
        </Button>
      </div>
    </Show>
  );
}

export function LibraryUpdatesDialog(props: {
  updates: readonly LibraryUpdate[];
  /** The library's note on its last publish, by library id. */
  notes: (library: string) => string | null;
  canEdit: boolean;
  updating: boolean;
  before: (u: LibraryUpdate) => Promise<string | null>;
  after: (u: LibraryUpdate) => Promise<string | null>;
  onUpdate: (list: readonly LibraryUpdate[]) => void;
  onClose: () => void;
}) {
  const libraries = () => [...new Set(props.updates.map((u) => u.library))];
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="w-120"
    >
      <Panel depth={2} class="rounded-xl *:max-h-[80vh]">
        <Panel.Body scroll>
          {/* Opened over the canvas: its presses stay in the dialog. */}
          <div
            class="flex flex-col gap-4 p-5 text-sm"
            data-testid="fig-library-review"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between gap-4">
              <Dialog.Title class="font-semibold text-base text-ink">
                Library updates
              </Dialog.Title>
              <Dialog.CloseButton
                as={Button}
                variant="ghost"
                size="icon-sm"
                label="Close"
                tabIndex={-1}
              >
                <XIcon />
              </Dialog.CloseButton>
            </div>
            <For each={libraries()}>
              {(library) => {
                const list = () =>
                  props.updates.filter((u) => u.library === library);
                return (
                  <section class="flex flex-col gap-2">
                    <h3 class="font-medium text-ink-muted text-xs">
                      {list()[0]?.libraryName}
                    </h3>
                    <Show when={props.notes(library)}>
                      {(note) => (
                        <p class="rounded-md bg-inset p-2 text-ink-muted text-xs">
                          {note()}
                        </p>
                      )}
                    </Show>
                    <ul class="flex flex-col gap-1">
                      <For each={list()}>
                        {(u) => (
                          <li
                            class="flex items-center gap-2"
                            data-testid="fig-library-update"
                          >
                            <AssetThumbnail
                              src={() => props.before(u)}
                              label={`${u.name}, this file`}
                              class="size-10"
                              owned
                            />
                            <ArrowRight class="size-3 shrink-0 text-ink-muted" />
                            <AssetThumbnail
                              src={() => props.after(u)}
                              label={`${u.name}, published`}
                              class="size-10"
                            />
                            <span class="min-w-0 flex-1 truncate text-ink">
                              {u.name}
                            </span>
                            <Show when={props.canEdit}>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={props.updating}
                                data-testid="fig-library-update-one"
                                onClick={() => props.onUpdate([u])}
                              >
                                Update
                              </Button>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                );
              }}
            </For>
            <Show when={props.canEdit}>
              <div class="flex justify-end">
                <Button
                  variant="cta"
                  size="sm"
                  data-testid="fig-library-update-all"
                  disabled={props.updating || props.updates.length === 0}
                  onClick={() => props.onUpdate(props.updates)}
                >
                  {props.updating ? 'Updating…' : 'Update all'}
                </Button>
              </div>
            </Show>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
