import PushPinIcon from '@icon/system/regular/push-pin.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { Badge, Button, cn, Tooltip } from '@ui';
import { type Component, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** An action a row can take, named for the value it acts on. */
export type RecordValueAction = {
  label: string;
  tooltip: string;
  run(): void;
};

/**
 * One of a record's listed values (a contact's address, a company's domain)
 * and the actions it can take: Remove, then Make primary (the side panel's
 * remove-then-pin order). A row reserves no room for them: on desktop they
 * take room only while the pointer is on the row or focus is in it, so the
 * value ends in an ellipsis and Primary stays; on touch they always show.
 */
export function RecordValueRow(props: {
  value: string;
  icon: Component<{ class?: string }>;
  primary: boolean;
  primaryLabel: string;
  /** Whether the values can be changed here at all. */
  manageable: boolean;
  busy: boolean;
  /** The editor's rows use the body text and are roomier. */
  size: 'details' | 'editor';
  /** Keeps the value, a person's address, out of session capture. */
  private?: boolean;
  /** The value's own button: it opens the editor in Record details. */
  openLabel: string;
  onOpen?: (anchor: HTMLButtonElement) => void;
  /** The value's button, where focus goes after an action that keeps it. */
  valueRef?: (element: HTMLButtonElement) => void;
  /** Whether the editor is open from this value. */
  expanded?: boolean;
  /** Absent when the row can't take the action. */
  remove?: RecordValueAction;
  makePrimary?: RecordValueAction;
}) {
  const capture = () => (props.private ? 'ph-no-capture' : undefined);
  const remove = () => (props.manageable ? props.remove : undefined);
  const makePrimary = () => (props.manageable ? props.makePrimary : undefined);
  const faceClass = () =>
    cn(
      'inline-flex min-w-0 items-center rounded-full text-left outline-none',
      props.size === 'editor'
        ? 'h-8 gap-2 px-2 text-sm text-ink touch:h-11'
        : 'h-6 gap-1 pl-2 text-xs text-ink-muted touch:h-9',
      props.manageable && 'not-touch:group-hover/value:text-ink'
    );
  const face = () => (
    <>
      <Dynamic
        component={props.icon}
        class={cn('shrink-0', props.size === 'editor' ? 'size-3.5' : 'size-3')}
      />
      <span class={cn('min-w-0 truncate', capture())}>{props.value}</span>
    </>
  );

  return (
    <div
      class={cn(
        'group/value flex min-w-0 items-center rounded-full',
        props.manageable &&
          'not-touch:hover:bg-button-tertiary-hover not-touch:focus-within:bg-button-tertiary-hover'
      )}
    >
      <Show
        when={props.manageable && props.onOpen}
        fallback={<span class={faceClass()}>{face()}</span>}
      >
        {(open) => (
          <Tooltip label={props.value} class="min-w-0">
            <button
              ref={(element) => props.valueRef?.(element)}
              type="button"
              class={cn(
                faceClass(),
                capture(),
                'focus-visible:ring-2 focus-visible:ring-accent/20'
              )}
              aria-label={props.openLabel}
              aria-haspopup="dialog"
              aria-expanded={props.expanded ?? false}
              onClick={(event) => open()(event.currentTarget)}
            >
              {face()}
            </button>
          </Tooltip>
        )}
      </Show>
      <Show when={props.primary}>
        <Badge variant="ghost" size="xs" class="shrink-0 border-0 pl-1.5 pr-0">
          {props.primaryLabel}
        </Badge>
      </Show>
      <Show when={remove() || makePrimary()}>
        <div class="ml-auto flex shrink-0 items-center gap-0.5 overflow-hidden pr-0.5 not-touch:w-0 not-touch:pr-0 not-touch:group-hover/value:w-auto not-touch:group-hover/value:pr-0.5 not-touch:group-focus-within/value:w-auto not-touch:group-focus-within/value:pr-0.5">
          <Show when={remove()}>
            {(action) => (
              <Button
                variant="danger-ghost"
                size="icon-xs"
                class={cn(
                  capture(),
                  'focus-visible:ring-2 focus-visible:ring-accent/20'
                )}
                aria-label={action().label}
                tooltip={action().tooltip}
                disabled={props.busy}
                onClick={() => action().run()}
              >
                <TrashIcon class="size-4" />
              </Button>
            )}
          </Show>
          <Show when={makePrimary()}>
            {(action) => (
              <Button
                variant="ghost"
                size="icon-xs"
                class={cn(
                  capture(),
                  'text-ink-extra-muted not-data-disabled:focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/20'
                )}
                aria-label={action().label}
                tooltip={action().tooltip}
                disabled={props.busy}
                onClick={() => action().run()}
              >
                <PushPinIcon class="size-4" />
              </Button>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
