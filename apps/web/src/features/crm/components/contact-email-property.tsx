import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { PropertyEmpty } from '@property/extractors/PropertyEmpty';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { badgeTriggerClasses, cn, Dialog, Dropdown, HoverCard } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ContactEmailChange } from '../core/contact';
import {
  type ChangeContactEmail,
  ContactEmailEditor,
} from './contact-email-editor';
import { ContactEmailRow } from './contact-email-row';
import { contactPropertyTouchTarget } from './contact-property-styles';
import { createValueChange, type ValueChange } from './value-change';

type ContactEmailProps = {
  emails: string[];
  primary: string | null | undefined;
  /** Whether the server listed the addresses, so they can be managed. */
  manageable: boolean;
  /** The one address on the company's domain, while the contact is linked. */
  companyEmail: string | undefined;
  change: ChangeContactEmail;
  errorMessage(error: unknown, change: ContactEmailChange): string;
};

/**
 * The property popover on desktop and the shared dialog (a drawer on phones),
 * shared by the contact email and company domain fields.
 */
export function ValueEditor(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  /** The desktop popover's width, when its content needs a fixed one. */
  popoverClass?: string;
  anchor(): DOMRect | undefined;
  trigger: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dropdown
          open={props.open}
          onOpenChange={props.onOpenChange}
          getAnchorRect={props.anchor}
          placement="bottom-start"
          fitViewport
        >
          {props.trigger}
          <Show when={props.open}>
            <EditorPopover
              class={props.popoverClass}
              onClose={() => props.onOpenChange(false)}
            >
              {props.children}
            </EditorPopover>
          </Show>
        </Dropdown>
      }
    >
      {props.trigger}
      <Show when={props.open}>
        <Dialog
          open
          onOpenChange={props.onOpenChange}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            props.onOpenChange(false);
          }}
        >
          <Dialog.Title class="px-3 pt-3 text-base font-semibold">
            {props.title}
          </Dialog.Title>
          {props.children}
        </Dialog>
      </Show>
    </Show>
  );
}

/**
 * Every value, the primary marked, for the header pill's hover card: a
 * contact's addresses or a company's domains.
 */
function RecordValueHoverList(props: {
  title: string;
  values: string[];
  primary: string;
  primaryLabel: string;
  private?: boolean;
}) {
  return (
    <div class="flex min-w-0 max-w-80 flex-col gap-1 text-sm">
      <span class="text-xs text-ink-muted">{props.title}</span>
      <For each={props.values}>
        {(value) => (
          <span class="flex min-w-0 items-center gap-2">
            <span
              class={cn('min-w-0 truncate', props.private && 'ph-no-capture')}
            >
              {value}
            </span>
            <Show when={value === props.primary}>
              <span class="shrink-0 text-xs text-ink-muted">
                {props.primaryLabel}
              </span>
            </Show>
          </span>
        )}
      </For>
    </div>
  );
}

/**
 * A record's listed values as one header pill, like a task's Tags or
 * Assignees: the primary value and how many others there are. Hovering lists
 * every value; the pill opens the editor. A record with none shows the empty
 * property. The first value swaps in a new button with its hover card;
 * `trigger` follows it, so focus still returns to the pill.
 */
export function RecordValuePill<Kind extends string>(props: {
  values: string[];
  /** The value the pill shows; the first when none is marked. */
  primary: string | null | undefined;
  editable: boolean;
  icon: Component<{ class?: string }>;
  /** Keeps a person's addresses out of session capture. */
  private?: boolean;
  /** The property's name on the empty pill, and over the hover list. */
  emptyLabel: string;
  listTitle: string;
  primaryLabel: string;
  /** The pill's accessible name, given the primary and how many others. */
  label(primary: string, others: number): string;
  editorTitle: string;
  change(value: string, kind: Kind): Promise<void>;
  errorMessage(error: unknown, kind: Kind): string;
  editor(request: ValueChange<Kind>, close: () => void): JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const editing = createValueChange(props.change, props.errorMessage);
  let trigger: HTMLButtonElement | undefined;
  const primary = () => props.primary ?? props.values[0] ?? '';
  const others = () => Math.max(props.values.length - 1, 0);
  const blank = () => props.values.length === 0;
  const editable = () => props.editable || blank();
  const capture = () => (props.private ? 'ph-no-capture' : undefined);
  // A change still saving keeps the editor open, so its outcome shows.
  const changeOpen = (next: boolean) => {
    if (editing.saving()) return;
    if (next) editing.clearError();
    setOpen(next);
    if (!next && !isTouchDevice()) trigger?.focus();
  };
  const face = () => (
    <Show when={!blank()} fallback={<PropertyEmpty label={props.emptyLabel} />}>
      <Dynamic component={props.icon} class="size-3 shrink-0" />
      <span class={cn('min-w-0 max-w-60 truncate', capture())}>
        {primary()}
      </span>
      <Show when={others() > 0}>
        <span class="shrink-0 text-ink-muted">+{others()}</span>
      </Show>
    </Show>
  );
  const hoverList = () => (
    <RecordValueHoverList
      title={props.listTitle}
      values={props.values}
      primary={primary()}
      primaryLabel={props.primaryLabel}
      private={props.private}
    />
  );
  const pill = () => (
    <button
      ref={trigger}
      type="button"
      class={propertyPillClasses({
        variant: 'secondary',
        size: 'xs',
        empty: blank(),
        class: cn('min-w-0 shrink', capture(), contactPropertyTouchTarget),
      })}
      aria-label={props.label(primary(), others())}
      aria-haspopup="dialog"
      aria-expanded={open()}
      onClick={() => changeOpen(true)}
    >
      {face()}
      <CaretDownIcon class="size-3 shrink-0" />
    </button>
  );

  return (
    <Show
      when={editable()}
      fallback={
        // Read-only values keep the card, reached by focus as well.
        <HoverCard
          triggerClass="min-w-0 max-w-full"
          placement="bottom-start"
          contentClass="menu-surface p-1.5 px-3"
          content={hoverList()}
        >
          <span
            class={propertyPillClasses({
              variant: 'secondary',
              size: 'xs',
              readOnly: true,
              class: cn('h-6 min-w-0', capture()),
            })}
            aria-label={props.label(primary(), others())}
          >
            {face()}
          </span>
        </HoverCard>
      }
    >
      <ValueEditor
        open={open()}
        onOpenChange={changeOpen}
        title={props.editorTitle}
        popoverClass="w-80 max-w-80"
        anchor={() => trigger?.getBoundingClientRect()}
        trigger={
          // A record with no values has nothing to list; a disabled hover card
          // would also mark the pill disabled.
          <Show when={!blank()} fallback={pill()}>
            <HoverCard
              triggerClass="min-w-0 max-w-full"
              triggerTabIndex={-1}
              placement="bottom-start"
              contentClass="menu-surface p-1.5 px-3"
              disabled={open()}
              content={hoverList()}
            >
              {pill()}
            </HoverCard>
          </Show>
        }
      >
        {props.editor(editing, () => changeOpen(false))}
      </ValueEditor>
    </Show>
  );
}

/** What a Record details row needs from its list. */
export type RecordValueListRow<Kind> = {
  busy: boolean;
  open(anchor: HTMLButtonElement): void;
  ref(element: HTMLButtonElement): void;
  expanded: boolean;
  run(kind: Kind): void;
};

/**
 * A record's listed values in Record details: one line per value, in the
 * value column the other rows use, then the side panel's add pill. A value
 * opens the editor too. After an action, focus goes where the page left it:
 * to the value itself, or to the add pill once the value is removed.
 */
export function RecordValueList<Kind extends string>(props: {
  values: string[];
  canAdd: boolean;
  label: string;
  addLabel: string;
  editorTitle: string;
  change(value: string, kind: Kind): Promise<void>;
  errorMessage(error: unknown, kind: Kind): string;
  row(value: string, row: RecordValueListRow<Kind>): JSX.Element;
  editor(request: ValueChange<Kind>, close: () => void): JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const request = createValueChange(props.change, props.errorMessage);
  const editing = createValueChange(props.change, props.errorMessage);
  let addControl: HTMLButtonElement | undefined;
  const elements = new Map<string, HTMLButtonElement>();
  // A value removed in the editor takes its button with it; the add pill
  // stands in for it, as the editor's anchor and for focus.
  const target = () => {
    const element = anchor();
    return element?.isConnected ? element : addControl;
  };
  const expandedFrom = (element: HTMLElement | undefined) =>
    open() && !!element && anchor() === element;

  // One change at a time: a row action still saving keeps the editor shut.
  const openEditor = (element: HTMLElement) => {
    if (editing.saving() || request.saving()) return;
    request.clearError();
    editing.clearError();
    setAnchor(element);
    setOpen(true);
  };
  // A change still saving keeps the editor open, so its outcome shows.
  const changeOpen = (next: boolean) => {
    if (editing.saving()) return;
    setOpen(next);
    if (next || isTouchDevice()) return;
    target()?.focus();
  };
  const run = async (value: string, kind: Kind) => {
    if (!(await request.run(value, kind)) || isTouchDevice()) return;
    queueMicrotask(() =>
      (kind === 'remove' ? addControl : elements.get(value))?.focus()
    );
  };

  return (
    <div
      role="group"
      aria-label={props.label}
      class="flex min-w-0 flex-col gap-1"
    >
      <ValueEditor
        open={open()}
        onOpenChange={changeOpen}
        title={props.editorTitle}
        popoverClass="w-80 max-w-80"
        anchor={() => target()?.getBoundingClientRect()}
        trigger={
          <>
            <For each={props.values}>
              {(value) =>
                props.row(value, {
                  get busy() {
                    return request.saving();
                  },
                  open: openEditor,
                  ref: (element) => elements.set(value, element),
                  get expanded() {
                    return expandedFrom(elements.get(value));
                  },
                  run: (kind) => fireAndForget(run(value, kind), 'crm'),
                })
              }
            </For>
            <Show when={props.canAdd}>
              <button
                ref={addControl}
                type="button"
                class={badgeTriggerClasses({
                  variant: 'outline',
                  size: 'xs',
                  class: 'w-fit gap-1.5',
                })}
                aria-label={props.addLabel}
                aria-haspopup="dialog"
                aria-expanded={expandedFrom(addControl)}
                onClick={(event) => openEditor(event.currentTarget)}
              >
                <PlusIcon class="size-3 shrink-0" />
                {props.addLabel}
              </button>
            </Show>
          </>
        }
      >
        {props.editor(editing, () => changeOpen(false))}
      </ValueEditor>
      <Show when={request.error()}>
        {(message) => (
          <p role="alert" class="px-2 text-xs text-failure">
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}

/** The email editor for a host that owns its request and its open state. */
function editor(
  props: ContactEmailProps,
  request: ValueChange<ContactEmailChange>,
  onClose: () => void
) {
  return (
    <ContactEmailEditor
      emails={props.emails}
      primary={props.primary}
      manageable={props.manageable}
      companyEmail={props.companyEmail}
      request={request}
      onClose={onClose}
    />
  );
}

/** The header's Email property: the primary address, +N and the editor. */
export function ContactEmailPill(props: ContactEmailProps) {
  return (
    <RecordValuePill
      values={props.emails}
      primary={props.primary}
      editable={props.manageable}
      icon={EnvelopeIcon}
      private
      emptyLabel={t('crm.email')}
      listTitle={t('crm.email')}
      primaryLabel={t('crm.primaryEmail')}
      label={(primary, others) => {
        if (props.emails.length === 0) return t('crm.addEmail');
        if (others === 0) return t('crm.contactEmailLabel', { email: primary });
        return t('crm.contactEmailSummary', { email: primary, count: others });
      }}
      editorTitle={t('crm.email')}
      change={props.change}
      errorMessage={props.errorMessage}
      editor={(request, close) => editor(props, request, close)}
    />
  );
}

/**
 * Record details' Email property: one line per address, in the value column
 * the Company pill uses, then the side panel's add pill. Make primary keeps
 * focus on the address; Remove moves it to Add email.
 */
export function ContactEmailList(props: ContactEmailProps) {
  return (
    <RecordValueList
      values={props.emails}
      canAdd={props.manageable || props.emails.length === 0}
      label={t('crm.email')}
      addLabel={t('crm.addEmail')}
      editorTitle={t('crm.email')}
      change={props.change}
      errorMessage={props.errorMessage}
      editor={(request, close) => editor(props, request, close)}
      row={(email, row) => (
        <ContactEmailRow
          size="details"
          email={email}
          primary={email === props.primary}
          linksCompany={email === props.companyEmail}
          manageable={props.manageable}
          busy={row.busy}
          onOpen={row.open}
          addressRef={row.ref}
          expanded={row.expanded}
          onMakePrimary={() => row.run('primary')}
          onRemove={() => row.run('remove')}
        />
      )}
    />
  );
}
