import CursorIcon from '@icon/wide-cursor-ide.svg';
import CodeIcon from '@phosphor/code.svg';
import GearIcon from '@phosphor/gear.svg';
import PlusIcon from '@phosphor/plus.svg';
import RobotIcon from '@phosphor/robot.svg';
import { Avatar, Button, cn } from '@ui';
import { For, Show } from 'solid-js';
import { relativeAge } from '../core/format-age';

/** One coder as the carousel shows it. */
export type CoderCard = {
  id: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  /** Cursor's own card wears the Cursor mark instead of a robot. */
  cursor?: boolean;
  system: boolean;
  runtime: { label: string; connected: boolean };
  model?: string;
  /** Epoch millis of its newest session in the loaded list; 0 when none. */
  lastUsedAt: number;
  sessions: number;
  unavailableReason?: string;
  connectLabel?: string;
  /** User-made coders open their settings from the card's gear. */
  configurable: boolean;
};

/**
 * Horizontally scrolling coder cards, most recently used first. One is
 * checked; the composer below addresses it.
 */
export function CoderCards(props: {
  coders: CoderCard[];
  selectedId: string | undefined;
  loading: boolean;
  onSelect: (id: string) => void;
  onConnect: (id: string) => void;
  onConfigure: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <section class="flex min-w-0 flex-col" aria-label="Coders">
      <div class="mb-2 flex items-center justify-between px-0.5">
        <div class="flex items-baseline gap-2">
          <h3 class="text-xs font-medium text-ink-subtle">Your coders</h3>
          <span class="text-xs text-ink-placeholder">by last used</span>
        </div>
        <Button
          variant="cta"
          size="sm"
          class="gap-1.5"
          onClick={props.onCreate}
        >
          <PlusIcon />
          Create coder
        </Button>
      </div>
      <div
        role="radiogroup"
        aria-label="Coder"
        aria-orientation="horizontal"
        class="flex min-w-0 snap-x gap-2 overflow-x-auto overscroll-x-contain px-0.5 pt-0.5 pb-1.5"
      >
        <For each={props.coders}>
          {(coder) => {
            const selected = () => coder.id === props.selectedId;
            const disabled = () =>
              !!coder.unavailableReason && !coder.connectLabel;
            return (
              <div
                class={cn(
                  'group relative w-58 shrink-0 snap-start rounded-[10px] border border-edge-muted bg-surface-0 transition-colors',
                  selected() && 'border-accent/60 bg-accent/5',
                  !selected() && !disabled() && 'hover:bg-hover'
                )}
              >
                <button
                  type="button"
                  role={coder.connectLabel ? 'button' : 'radio'}
                  aria-label={coder.connectLabel}
                  aria-checked={coder.connectLabel ? undefined : selected()}
                  aria-disabled={disabled()}
                  data-coder-id={coder.id}
                  title={[
                    coder.name,
                    `@${coder.handle}`,
                    coder.unavailableReason,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  class={cn(
                    'grid w-full gap-2.5 rounded-[10px] p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
                    disabled() && 'opacity-50'
                  )}
                  onClick={() => {
                    if (disabled()) return;
                    if (coder.connectLabel) props.onConnect(coder.id);
                    else props.onSelect(coder.id);
                  }}
                >
                  <span class="flex min-w-0 items-center gap-2.5 pr-7">
                    <span class="relative inline-grid shrink-0">
                      <Avatar
                        size="lg"
                        shape="square"
                        class="size-8 rounded-lg bg-surface text-accent ring ring-edge-muted"
                      >
                        <Show
                          when={coder.avatarUrl}
                          fallback={
                            <Avatar.Fallback>
                              <Show
                                when={coder.cursor}
                                fallback={<RobotIcon class="size-4.5" />}
                              >
                                <CursorIcon class="size-4.5" />
                              </Show>
                            </Avatar.Fallback>
                          }
                        >
                          {(url) => <Avatar.Image src={url()} alt="" />}
                        </Show>
                      </Avatar>
                      <span
                        aria-hidden="true"
                        class="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-[5px] bg-accent text-accent-contrast ring-2 ring-surface-0"
                      >
                        <CodeIcon class="size-2.5" />
                      </span>
                    </span>
                    <span class="min-w-0">
                      <span class="flex min-w-0 items-baseline gap-1.5">
                        <span class="truncate text-sm font-medium text-ink">
                          {coder.name}
                        </span>
                        <Show when={coder.system}>
                          <span class="shrink-0 rounded-full border border-accent/35 bg-accent/8 px-1.5 text-[9px] font-medium uppercase tracking-wide text-accent">
                            system
                          </span>
                        </Show>
                      </span>
                      <span class="block truncate text-xs text-ink-placeholder">
                        @{coder.handle}
                      </span>
                    </span>
                  </span>
                  <span class="flex min-w-0 items-center gap-1.5 text-xs text-ink-subtle">
                    <span
                      aria-hidden="true"
                      class={cn(
                        'size-1.5 shrink-0 rounded-full',
                        coder.runtime.connected
                          ? 'bg-success'
                          : 'bg-ink-disabled'
                      )}
                    />
                    <span class="shrink-0">{coder.runtime.label}</span>
                    <Show when={coder.model}>
                      {(model) => (
                        <>
                          <span class="text-ink-placeholder">·</span>
                          <span class="truncate font-mono text-[11px]">
                            {model()}
                          </span>
                        </>
                      )}
                    </Show>
                  </span>
                  <span class="flex items-center justify-between border-t border-edge-muted pt-2 text-xs text-ink-placeholder">
                    <span class="truncate">
                      <Show
                        when={coder.unavailableReason}
                        fallback={
                          <Show when={coder.lastUsedAt} fallback="Not used yet">
                            Last used{' '}
                            <b class="font-medium text-ink-subtle">
                              {relativeAge(coder.lastUsedAt)}
                            </b>
                          </Show>
                        }
                      >
                        {(reason) => <span>{reason()}</span>}
                      </Show>
                    </span>
                    <span class="shrink-0 tabular-nums">
                      {coder.sessions}{' '}
                      {coder.sessions === 1 ? 'session' : 'sessions'}
                    </span>
                  </span>
                </button>
                <Show when={coder.configurable}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    label={`Configure ${coder.name}`}
                    class={cn(
                      'absolute top-2 right-2 size-7 rounded-lg text-ink-placeholder opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
                      selected() && 'opacity-100'
                    )}
                    onClick={() => props.onConfigure(coder.id)}
                  >
                    <GearIcon class="size-3.5" />
                  </Button>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
      <Show when={props.loading}>
        <span role="status" class="px-1 pt-1 text-xs text-ink-muted">
          Loading coders…
        </span>
      </Show>
    </section>
  );
}
