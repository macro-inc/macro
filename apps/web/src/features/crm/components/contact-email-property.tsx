import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { PropertyEmpty } from '@property/extractors/PropertyEmpty';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { badgeTriggerClasses, Dialog, Dropdown, HoverCard } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
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

/** Every address, the primary marked, for the header pill's hover card. */
export function ValueError(props: { message: string | undefined }) {
  return (
    <Show when={props.message}>
      {(message) => (
        <p role="alert" class="text-sm text-failure">
          {message()}
        </p>
      )}
    </Show>
  );
}

function ContactEmailHoverList(props: { emails: string[]; primary: string }) {
  return (
    <div class="flex min-w-0 max-w-80 flex-col gap-1 text-sm">
      <span class="text-xs text-ink-muted">{t('crm.email')}</span>
      <For each={props.emails}>
        {(email) => (
          <span class="flex min-w-0 items-center gap-2">
            <span class="ph-no-capture min-w-0 truncate">{email}</span>
            <Show when={email === props.primary}>
              <span class="shrink-0 text-xs text-ink-muted">
                {t('crm.primaryEmail')}
              </span>
            </Show>
          </span>
        )}
      </For>
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

/**
 * The header's Email property: one pill, like a task's Tags or Assignees,
 * showing the primary address and how many others there are. Hovering lists
 * every address; the pill opens the email editor. A blank contact shows the
 * empty property. The first address swaps in a new button with its hover card;
 * `trigger` follows it, so focus still returns to the pill.
 */
export function ContactEmailPill(props: ContactEmailProps) {
  const [open, setOpen] = createSignal(false);
  const editing = createValueChange(props.change, props.errorMessage);
  let trigger: HTMLButtonElement | undefined;
  const primary = () => props.primary ?? props.emails[0] ?? '';
  const others = () => Math.max(props.emails.length - 1, 0);
  const blank = () => props.emails.length === 0;
  const editable = () => props.manageable || blank();
  const label = () => {
    if (blank()) return t('crm.addEmail');
    if (others() === 0) return t('crm.contactEmailLabel', { email: primary() });
    return t('crm.contactEmailSummary', {
      email: primary(),
      count: others(),
    });
  };
  // A change still saving keeps the editor open, so its outcome shows.
  const changeOpen = (next: boolean) => {
    if (editing.saving()) return;
    if (next) editing.clearError();
    setOpen(next);
    if (!next && !isTouchDevice()) trigger?.focus();
  };
  const face = () => (
    <Show when={!blank()} fallback={<PropertyEmpty label={t('crm.email')} />}>
      <EnvelopeIcon class="size-3 shrink-0" />
      <span class="ph-no-capture min-w-0 max-w-60 truncate">{primary()}</span>
      <Show when={others() > 0}>
        <span class="shrink-0 text-ink-muted">+{others()}</span>
      </Show>
    </Show>
  );
  const hoverList = () => (
    <ContactEmailHoverList emails={props.emails} primary={primary()} />
  );
  const pill = () => (
    <button
      ref={trigger}
      type="button"
      class={propertyPillClasses({
        variant: 'secondary',
        size: 'xs',
        empty: blank(),
        class: `ph-no-capture min-w-0 shrink ${contactPropertyTouchTarget}`,
      })}
      aria-label={label()}
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
        // Read-only addresses keep the card, reached by focus as well.
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
              class: 'ph-no-capture h-6 min-w-0',
            })}
            aria-label={label()}
          >
            {face()}
          </span>
        </HoverCard>
      }
    >
      <ValueEditor
        open={open()}
        onOpenChange={changeOpen}
        title={t('crm.email')}
        popoverClass="w-80 max-w-80"
        anchor={() => trigger?.getBoundingClientRect()}
        trigger={
          // A blank contact has nothing to list; a disabled hover card would
          // also mark the pill disabled.
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
        {editor(props, editing, () => changeOpen(false))}
      </ValueEditor>
    </Show>
  );
}

/**
 * Record details' Email property: one line per address, in the value column
 * the Company pill uses, then the side panel's add pill. An address opens the
 * email editor too. After an action, focus goes where the page left it: to
 * the address made primary, or to Add email once an address is removed.
 */
export function ContactEmailList(props: ContactEmailProps) {
  const [open, setOpen] = createSignal(false);
  const [anchor, setAnchor] = createSignal<HTMLElement>();
  const request = createValueChange(props.change, props.errorMessage);
  const editing = createValueChange(props.change, props.errorMessage);
  let addControl: HTMLButtonElement | undefined;
  const addresses = new Map<string, HTMLButtonElement>();
  const canAdd = () => props.manageable || props.emails.length === 0;
  // An address removed in the editor takes its button with it; Add email
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
  const run = async (email: string, kind: 'remove' | 'primary') => {
    if (!(await request.run(email, kind)) || isTouchDevice()) return;
    queueMicrotask(() =>
      (kind === 'remove' ? addControl : addresses.get(email))?.focus()
    );
  };
  const rows = (): JSX.Element => (
    <For each={props.emails}>
      {(email) => (
        <ContactEmailRow
          size="details"
          email={email}
          primary={email === props.primary}
          linksCompany={email === props.companyEmail}
          manageable={props.manageable}
          busy={request.saving()}
          onOpen={openEditor}
          addressRef={(element) => addresses.set(email, element)}
          expanded={expandedFrom(addresses.get(email))}
          onMakePrimary={() => fireAndForget(run(email, 'primary'), 'crm')}
          onRemove={() => fireAndForget(run(email, 'remove'), 'crm')}
        />
      )}
    </For>
  );

  return (
    <div
      role="group"
      aria-label={t('crm.email')}
      class="flex min-w-0 flex-col gap-1"
    >
      <ValueEditor
        open={open()}
        onOpenChange={changeOpen}
        title={t('crm.email')}
        popoverClass="w-80 max-w-80"
        anchor={() => target()?.getBoundingClientRect()}
        trigger={
          <>
            {rows()}
            <Show when={canAdd()}>
              <button
                ref={addControl}
                type="button"
                class={badgeTriggerClasses({
                  variant: 'outline',
                  size: 'xs',
                  class: 'w-fit gap-1.5',
                })}
                aria-label={t('crm.addEmail')}
                aria-haspopup="dialog"
                aria-expanded={expandedFrom(addControl)}
                onClick={(event) => openEditor(event.currentTarget)}
              >
                <PlusIcon class="size-3 shrink-0" />
                {t('crm.addEmail')}
              </button>
            </Show>
          </>
        }
      >
        {editor(props, editing, () => changeOpen(false))}
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
