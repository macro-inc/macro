import CheckIcon from '@phosphor/check.svg';
import RobotIcon from '@phosphor/robot.svg';
import { Avatar, cn } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import type { PersonaOption } from './compose-agent-session-options';

/** Horizontally scrollable agent choices, with recent selections first. */
export function AgentPicker(props: {
  personas: PersonaOption[];
  recentIds: string[];
  selected: PersonaOption | undefined;
  loading: boolean;
  error: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onConnect: (id: string) => void;
}) {
  let listRef: HTMLDivElement | undefined;
  const sorted = createMemo(() => {
    const order = new Map(props.recentIds.map((id, index) => [id, index]));
    return [...props.personas].sort(
      (a, b) =>
        (order.get(a.id) ?? props.recentIds.length) -
        (order.get(b.id) ?? props.recentIds.length)
    );
  });
  const selectable = () => sorted().filter((item) => !item.unavailableReason);
  const navigable = () =>
    sorted().filter((item) => !item.unavailableReason || item.connectLabel);
  const tabStop = () =>
    selectable().find((item) => item.id === props.selected?.id)?.id ??
    selectable()[0]?.id;

  const focusAgent = (id: string) => {
    const row = Array.from(
      listRef?.querySelectorAll<HTMLElement>('[data-persona-id]') ?? []
    ).find((element) => element.dataset.personaId === id);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const moveSelection = (event: KeyboardEvent) => {
    if (props.disabled) return;
    const choices = navigable();
    if (choices.length === 0) return;
    const focusedId =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[data-persona-id]')?.dataset
            .personaId
        : undefined;
    const current = choices.findIndex(
      (item) => item.id === (focusedId ?? props.selected?.id)
    );
    let next: PersonaOption | undefined;
    if (event.key === 'ArrowRight') {
      next = choices[(current + 1) % choices.length];
    } else if (event.key === 'ArrowLeft') {
      next = choices[(current - 1 + choices.length) % choices.length];
    } else if (event.key === 'Home') {
      next = choices[0];
    } else if (event.key === 'End') {
      next = choices.at(-1);
    }
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    if (!next.connectLabel) props.onSelect(next.id);
    focusAgent(next.id);
  };

  return (
    <section class="flex min-w-0 shrink-0 flex-col" aria-label="Agent">
      <Show when={props.loading}>
        <span role="status" class="px-2 pb-1 text-xs text-ink-muted">
          Loading agents…
        </span>
      </Show>
      <div
        ref={listRef}
        role="radiogroup"
        aria-label="Agent"
        aria-orientation="horizontal"
        class="flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain"
        onKeyDown={moveSelection}
      >
        <For each={sorted()}>
          {(persona) => {
            const selected = () => persona.id === props.selected?.id;
            const disabled = () =>
              props.disabled ||
              (!!persona.unavailableReason && !persona.connectLabel);
            return (
              <button
                type="button"
                role={persona.connectLabel ? 'button' : 'radio'}
                aria-label={persona.connectLabel}
                aria-checked={persona.connectLabel ? undefined : selected()}
                aria-disabled={disabled()}
                data-persona-id={persona.id}
                tabIndex={
                  persona.connectLabel || tabStop() === persona.id ? 0 : -1
                }
                title={[
                  persona.name,
                  `@${persona.handle}`,
                  persona.unavailableReason ?? persona.description,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                class={cn(
                  'flex h-14 w-48 max-w-full shrink-0 items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
                  selected()
                    ? 'bg-accent/5 text-ink'
                    : 'text-ink hover:bg-hover',
                  disabled() && 'opacity-45'
                )}
                onClick={() => {
                  if (disabled()) return;
                  if (persona.connectLabel) props.onConnect(persona.id);
                  else props.onSelect(persona.id);
                }}
              >
                <Avatar size="sm" class="shrink-0 bg-surface-2 text-ink-muted">
                  <Show
                    when={persona.avatarUrl}
                    fallback={
                      <Avatar.Fallback>
                        <RobotIcon class="size-4" />
                      </Avatar.Fallback>
                    }
                  >
                    {(url) => <Avatar.Image src={url()} alt="" />}
                  </Show>
                </Avatar>
                <span class="min-w-0 flex-1">
                  <span class="flex min-w-0 items-baseline gap-2">
                    <span class="truncate text-sm font-medium">
                      {persona.name}
                    </span>
                  </span>
                  <span class="block truncate text-xs text-ink-muted">
                    @{persona.handle}
                    <Show when={persona.unavailableReason}>
                      {' · '}
                      {persona.unavailableReason}
                    </Show>
                  </span>
                </span>
                <CheckIcon
                  class={cn(
                    'size-4 shrink-0 text-accent',
                    !selected() && 'invisible'
                  )}
                />
              </button>
            );
          }}
        </For>
      </div>
      <Show when={sorted().length === 0 && !props.loading}>
        <p role="status" class="px-2 py-6 text-center text-sm text-ink-muted">
          No agents available.
        </p>
      </Show>
      <Show when={props.error}>
        <p role="alert" class="px-2 pt-2 text-xs text-negative">
          Your saved agents could not be loaded. Macro is still available.
        </p>
      </Show>
    </section>
  );
}
