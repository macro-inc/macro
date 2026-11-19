import { t } from '@app/lib/i18n';
import PlusIcon from '@icon/system/regular/plus.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import TrayIcon from '@icon/system/regular/tray.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, ButtonGroup, cn, Dropdown, Tooltip } from '@ui';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  type EventTriggerDraft,
  eventScopeKind,
  type RoutineTriggerDraft,
} from '../core/routine-triggers';
import { menuMount } from './routine-search-menu';
import type { EventSlots } from './routine-trigger-slots';

type FilterProps = EventSlots & {
  trigger: EventTriggerDraft;
  onSave: (trigger: RoutineTriggerDraft) => void;
};

/** Cancel keeps the filter as it was; Done saves it. */
function FilterActions(props: { onCancel: () => void; onDone: () => void }) {
  return (
    <div class="flex items-center justify-end gap-1.5 border-t border-edge-muted px-3.5 py-2.5">
      <Button variant="ghost" size="sm" onClick={() => props.onCancel()}>
        {t('common.cancel')}
      </Button>
      <Button variant="primary" size="sm" onClick={() => props.onDone()}>
        {t('routineFilters.done')}
      </Button>
    </div>
  );
}

/** Edits a trigger's AI check. */
function ConditionBody(props: FilterProps & { onClose: () => void }) {
  const [condition, setCondition] = createSignal(props.trigger.condition);
  return (
    <>
      <div class="min-h-0 overflow-y-auto px-3.5 pb-3.5 pt-3">
        {props.renderEventCondition?.(
          () => ({ ...props.trigger, condition: condition() }),
          setCondition
        )}
      </div>
      <FilterActions
        onCancel={() => props.onClose()}
        onDone={() => {
          const value = condition()?.trim();
          props.onSave({
            ...props.trigger,
            condition: value ? value : undefined,
          });
          props.onClose();
        }}
      />
    </>
  );
}

/** Edits the inboxes an email trigger watches. */
function InboxBody(props: FilterProps & { onClose: () => void }) {
  const [inboxes, setInboxes] = createSignal(props.trigger.inboxes ?? []);
  return (
    <>
      <div class="min-h-0 overflow-y-auto px-3.5 pb-3.5 pt-3">
        {props.renderInboxPicker?.(inboxes, setInboxes)}
      </div>
      <FilterActions
        onCancel={() => props.onClose()}
        onDone={() => {
          props.onSave({
            ...props.trigger,
            inboxes: inboxes().length ? inboxes() : undefined,
          });
          props.onClose();
        }}
      />
    </>
  );
}

type FilterKind = 'inbox' | 'condition';

/** The filters a trigger can still take, in the order "+ Filter" offers them. */
export function addableFilters(
  slots: EventSlots,
  trigger: EventTriggerDraft
): FilterKind[] {
  const kinds: FilterKind[] = [];
  if (
    slots.renderInboxPicker &&
    eventScopeKind(trigger) === 'THREAD' &&
    !trigger.inboxes?.length
  )
    kinds.push('inbox');
  if (slots.renderEventCondition && !trigger.condition?.trim())
    kinds.push('condition');
  return kinds;
}

/** A filter hanging off its trigger on a connector elbow. */
function FilterRow(props: { children: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        class="-mt-4 h-4.5 w-3.5 shrink-0 rounded-bl-md border-b border-l border-edge"
      />
      {props.children}
    </div>
  );
}

/** A filter's editing surface, anchored to its row. */
function FilterPopover(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  row: (anchor: (element: HTMLDivElement) => void) => JSX.Element;
  children: JSX.Element;
}) {
  let anchor: HTMLDivElement | undefined;
  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      anchorRef={() => anchor}
      placement="bottom-start"
      gutter={6}
    >
      <FilterRow>
        {props.row((element) => {
          anchor = element;
        })}
      </FilterRow>
      <Popover.Portal mount={menuMount(anchor)}>
        <Popover.Content class="menu-surface z-modal flex max-h-[min(36rem,var(--kb-popper-content-available-height))] w-[22rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden">
          <Popover.Title class="sr-only">{props.title}</Popover.Title>
          {props.children}
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/** "Label | value | ×": a filter a trigger has, opened to edit it. */
function FilterChip(props: {
  icon: JSX.Element;
  label: string;
  value: JSX.Element;
  /** The value in full, when it is plain text that may be cut short. */
  tooltip?: string;
  editLabel: string;
  open: boolean;
  onOpen: () => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  const value = () => <span class="min-w-0 truncate">{props.value}</span>;
  return (
    <ButtonGroup class="min-w-0 max-w-full">
      <Popover.Trigger
        as={ButtonGroup.Button}
        class="shrink-0 gap-1.5"
        aria-label={props.editLabel}
      >
        {props.icon}
        <span class="text-ink-muted">{props.label}</span>
      </Popover.Trigger>
      <ButtonGroup.Divider />
      <ButtonGroup.Button
        class="min-w-0 shrink"
        aria-haspopup="dialog"
        aria-expanded={props.open}
        onClick={() => props.onOpen()}
      >
        <Show when={props.tooltip} fallback={value()}>
          {(tooltip) => (
            <Tooltip label={tooltip()} as="span" class="min-w-0">
              {value()}
            </Tooltip>
          )}
        </Show>
      </ButtonGroup.Button>
      <ButtonGroup.Divider />
      <ButtonGroup.Button
        size="icon-md"
        aria-label={props.removeLabel}
        onClick={() => props.onRemove()}
      >
        <XIcon class="size-3.5" />
      </ButtonGroup.Button>
    </ButtonGroup>
  );
}

/** "✦ Only if | question | ×": the trigger's AI check. */
function ConditionFilter(props: FilterProps & { question: string }) {
  const [open, setOpen] = createSignal(false);
  return (
    <FilterPopover
      open={open()}
      onOpenChange={setOpen}
      title={t('routineFilters.editCondition')}
      row={(anchor) => (
        <div ref={anchor} class="flex min-w-0 max-w-full">
          <FilterChip
            icon={<SparkleIcon class="size-3.5 shrink-0 text-accent" />}
            label={t('routineFilters.onlyIf')}
            value={props.question}
            tooltip={props.question}
            editLabel={t('routineFilters.editConditionOf', {
              question: props.question,
            })}
            open={open()}
            onOpen={() => setOpen(true)}
            onRemove={() =>
              props.onSave({ ...props.trigger, condition: undefined })
            }
            removeLabel={t('routineFilters.removeCondition')}
          />
        </div>
      )}
    >
      <ConditionBody {...props} onClose={() => setOpen(false)} />
    </FilterPopover>
  );
}

/** "▭ Only | team@example.com | ×": the inboxes an email trigger watches. */
function InboxFilter(props: FilterProps & { inboxes: string[] }) {
  const [open, setOpen] = createSignal(false);
  return (
    <FilterPopover
      open={open()}
      onOpenChange={setOpen}
      title={t('routineFilters.editInboxes')}
      row={(anchor) => (
        <div ref={anchor} class="flex min-w-0 max-w-full">
          <FilterChip
            icon={<TrayIcon class="size-3.5 shrink-0 text-ink-muted" />}
            label={t('routineFilters.only')}
            value={props.renderInboxesLabel?.(props.inboxes)}
            editLabel={t('routineFilters.editInboxes')}
            open={open()}
            onOpen={() => setOpen(true)}
            onRemove={() =>
              props.onSave({ ...props.trigger, inboxes: undefined })
            }
            removeLabel={t('routineFilters.watchEveryInbox')}
          />
        </div>
      )}
    >
      <InboxBody {...props} onClose={() => setOpen(false)} />
    </FilterPopover>
  );
}

const FILTER_CHOICES: Record<
  FilterKind,
  {
    label: () => string;
    description: () => string;
    icon: Component<{ class?: string }>;
    iconClass: string;
  }
> = {
  inbox: {
    label: () => t('routineFilters.inbox'),
    description: () => t('routineFilters.inboxDescription'),
    icon: TrayIcon,
    iconClass: 'text-ink-muted',
  },
  condition: {
    label: () => t('routineFilters.condition'),
    description: () => t('routineFilters.conditionDescription'),
    icon: SparkleIcon,
    iconClass: 'text-accent',
  },
};

function AddFilterLabel() {
  return (
    <>
      <PlusIcon class="size-3.5 shrink-0" />
      {t('routineFilters.filter')}
    </>
  );
}

/**
 * "+ Filter": a menu of the filters the trigger can still take, then the
 * chosen one's editor; with only one left, its editor straight away.
 */
function AddFilter(props: FilterProps & { kinds: FilterKind[] }) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [picked, setPicked] = createSignal<FilterKind>();
  const kind = () => (props.kinds.length === 1 ? props.kinds[0] : picked());
  const close = () => {
    setOpen(false);
    setPicked(undefined);
  };
  return (
    <FilterPopover
      open={open()}
      onOpenChange={(value) => (value ? setOpen(true) : close())}
      title={t('routineFilters.addFilter')}
      row={(anchor) => (
        <div ref={anchor} class="flex min-w-0 max-w-full">
          <Show
            when={props.kinds.length > 1}
            fallback={
              <Popover.Trigger
                as={Button}
                variant="ghost"
                size="sm"
                aria-label={t('routineFilters.addFilter')}
              >
                <AddFilterLabel />
              </Popover.Trigger>
            }
          >
            {/* Not modal: the chosen filter's editor opens as the menu closes. */}
            <Dropdown
              open={menuOpen()}
              onOpenChange={setMenuOpen}
              modal={false}
              placement="bottom-start"
            >
              <Dropdown.Trigger
                variant="ghost"
                size="sm"
                aria-label={t('routineFilters.addFilter')}
              >
                <AddFilterLabel />
              </Dropdown.Trigger>
              <Dropdown.Content class="min-w-72 max-w-[min(24rem,calc(100vw-1rem))]">
                <For each={props.kinds}>
                  {(choice) => (
                    <Dropdown.Item
                      class="items-start gap-2 touch:min-h-11"
                      onSelect={() => {
                        setPicked(choice);
                        setOpen(true);
                      }}
                    >
                      <Dynamic
                        component={FILTER_CHOICES[choice].icon}
                        class={cn(
                          'mt-0.5 size-4 shrink-0',
                          FILTER_CHOICES[choice].iconClass
                        )}
                      />
                      <span class="flex min-w-0 flex-1 flex-col">
                        <Dropdown.ItemLabel class="truncate">
                          {FILTER_CHOICES[choice].label()}
                        </Dropdown.ItemLabel>
                        <Dropdown.ItemDescription class="text-xs leading-4 text-ink-muted">
                          {FILTER_CHOICES[choice].description()}
                        </Dropdown.ItemDescription>
                      </span>
                    </Dropdown.Item>
                  )}
                </For>
              </Dropdown.Content>
            </Dropdown>
          </Show>
        </div>
      )}
    >
      <Switch>
        <Match when={kind() === 'inbox'}>
          <InboxBody {...props} onClose={close} />
        </Match>
        <Match when={kind() === 'condition'}>
          <ConditionBody {...props} onClose={close} />
        </Match>
      </Switch>
    </FilterPopover>
  );
}

/** A trigger's filters, each on its elbow, then "+ Filter" while more fit. */
export function TriggerFilters(props: FilterProps) {
  const inboxes = () =>
    eventScopeKind(props.trigger) === 'THREAD' && props.trigger.inboxes?.length
      ? props.trigger.inboxes
      : undefined;
  const kinds = () => addableFilters(props, props.trigger);
  return (
    <div class="flex min-w-0 flex-col gap-2 pl-4.5">
      <Show when={inboxes()}>
        {(value) => <InboxFilter {...props} inboxes={value()} />}
      </Show>
      <Show when={props.trigger.condition?.trim()}>
        {(question) => <ConditionFilter {...props} question={question()} />}
      </Show>
      <Show when={kinds().length}>
        <AddFilter {...props} kinds={kinds()} />
      </Show>
    </div>
  );
}
