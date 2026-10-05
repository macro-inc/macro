/**
 * Figma's Libraries dialog: this file's library (its publishing state and
 * the Publish action), and the other designs that publish libraries, each
 * turned on or off for this file. Presentational.
 */

import type {
  LibraryCopy,
  LibraryRef,
  LibraryStatus,
} from '@core/fig-engine/library-types';
import BookOpen from '@phosphor/book-open.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import XIcon from '@phosphor/x.svg';
import { Button, Dialog, Panel, ToggleSwitch } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { FigLibraryDocument } from '../context/fig-libraries';
import type { LoadedLibrary } from '../primitives/create-fig-libraries';

export function LibrariesDialog(props: {
  fileName: string;
  /** This file's publishing state. */
  status: LibraryStatus | undefined;
  /** Other designs the person can open; `undefined` while loading. */
  documents: readonly FigLibraryDocument[] | undefined;
  enabled: readonly LibraryRef[];
  loaded: ReadonlyMap<string, LoadedLibrary>;
  canEdit: boolean;
  onToggle: (library: LibraryRef, on: boolean) => void;
  onPublish: () => void;
  /** Copies of assets no enabled library offers (they stay as they are). */
  detached: readonly LibraryCopy[];
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal('');
  const isOn = (id: string) => props.enabled.some((l) => l.id === id);
  /** Designs to list: matching the search; enabled ones even if unlisted. */
  const rows = () => {
    const q = query().trim().toLowerCase();
    const docs = props.documents ?? [];
    const missing = props.enabled.filter(
      (l) => !docs.some((d) => d.id === l.id)
    );
    // Libraries in use, then published ones, then the rest.
    const rank = (id: string) => {
      if (isOn(id)) return 0;
      const l = props.loaded.get(id);
      return l?.state === 'ready' && l.published.published ? 1 : 2;
    };
    return [...missing, ...docs]
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .map((d, i) => ({ d, i }))
      .sort((a, b) => rank(a.d.id) - rank(b.d.id) || a.i - b.i)
      .map(({ d }) => d);
  };
  const note = (id: string) => {
    const l = props.loaded.get(id);
    if (!l) return isOn(id) ? 'Loading…' : '';
    if (l.state === 'loading') return 'Loading…';
    if (l.state === 'failed') return 'Unavailable';
    const n = l.published.assets.filter(
      (a) => a.kind !== 'COMPONENT_SET'
    ).length;
    if (!l.published.published) return 'Not published';
    return n === 1 ? '1 asset' : `${n} assets`;
  };
  const changes = () => props.status?.changes.length ?? 0;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="w-120"
    >
      <Panel depth={2} class="rounded-xl *:max-h-[80vh]">
        <Panel.Body scroll>
          <div
            class="flex flex-col gap-4 p-5 text-sm"
            data-testid="fig-libraries-dialog"
          >
            <div class="flex items-center justify-between gap-4">
              <Dialog.Title class="font-semibold text-base text-ink">
                Libraries
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
            <section class="flex flex-col gap-2">
              <h3 class="font-medium text-ink-muted text-xs">This file</h3>
              <div class="flex items-center gap-3 rounded-lg border border-edge-muted p-3">
                <BookOpen class="size-4 shrink-0 text-accent" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-ink">{props.fileName}</div>
                  <div
                    class="text-ink-muted text-xs"
                    data-testid="fig-library-status"
                  >
                    {!props.status
                      ? ' '
                      : !props.status.published
                        ? `${props.status.assets} assets, not published`
                        : changes() > 0
                          ? `${changes()} ${changes() === 1 ? 'change' : 'changes'} to publish`
                          : 'Published, no changes'}
                  </div>
                </div>
                <Show when={props.canEdit}>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="fig-library-publish"
                    disabled={
                      !props.status ||
                      (props.status.published && changes() === 0) ||
                      props.status.assets === 0
                    }
                    onClick={() => props.onPublish()}
                  >
                    Publish…
                  </Button>
                </Show>
              </div>
            </section>
            <section class="flex flex-col gap-2">
              <h3 class="font-medium text-ink-muted text-xs">Designs</h3>
              <label class="flex items-center gap-2 rounded-md bg-input px-2 py-1 text-xs">
                <MagnifyingGlass class="size-3.5 text-ink-muted" />
                <input
                  class="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-placeholder"
                  placeholder="Search designs"
                  data-testid="fig-libraries-search"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                />
              </label>
              <Show
                when={props.documents}
                fallback={
                  <p class="text-ink-muted text-xs">Loading designs…</p>
                }
              >
                <ul class="flex flex-col">
                  <For
                    each={rows()}
                    fallback={
                      <li class="py-2 text-ink-muted text-xs">
                        No other designs found.
                      </li>
                    }
                  >
                    {(d) => (
                      <li
                        class="flex items-center gap-3 py-1.5"
                        data-testid="fig-library-row"
                        data-library={d.id}
                      >
                        <BookOpen class="size-3.5 shrink-0 text-ink-muted" />
                        <span class="min-w-0 flex-1 truncate text-ink">
                          {d.name}
                        </span>
                        <span class="text-ink-muted text-xs">{note(d.id)}</span>
                        <span data-testid="fig-library-toggle">
                          <ToggleSwitch
                            checked={isOn(d.id)}
                            disabled={!props.canEdit}
                            label={<span class="sr-only">Use {d.name}</span>}
                            onChange={(on) =>
                              props.onToggle({ id: d.id, name: d.name }, on)
                            }
                          />
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>
            <Show when={props.detached.length > 0}>
              <section
                class="flex flex-col gap-1"
                data-testid="fig-library-detached"
              >
                <h3 class="font-medium text-ink-muted text-xs">Not updated</h3>
                <p class="text-ink-muted text-xs">
                  These came from libraries this file no longer uses, or that no
                  longer publish them. They stay as they are.
                </p>
                <p class="truncate text-ink text-xs">
                  {props.detached.map((c) => c.name).join(', ')}
                </p>
              </section>
            </Show>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
