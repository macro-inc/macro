import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { useSearchInputFocus } from '@property/utils';
import { Badge, Button, Dialog, Dropdown, Input, Tooltip } from '@ui';
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { contactPropertyTouchTarget } from './contact-property-styles';

export type ContactEmailChange = 'add' | 'remove' | 'primary';

type ChangeEmail = (email: string, change: ContactEmailChange) => Promise<void>;

/** One pending change at a time, with the rejection kept beside its control. */
function createEmailChange(
  change: ChangeEmail,
  message: (e: unknown) => string
) {
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let active = true;
  onCleanup(() => {
    active = false;
  });

  return {
    saving,
    error,
    clearError: () => setError(undefined),
    /** Resolves to whether the server committed the change. */
    async run(email: string, kind: ContactEmailChange) {
      if (saving()) return false;
      setSaving(true);
      setError(undefined);
      try {
        await change(email, kind);
        return true;
      } catch (cause) {
        if (active) setError(message(cause));
        return false;
      } finally {
        if (active) setSaving(false);
      }
    },
  };
}

/** The property popover on desktop and the shared dialog on touch. */
function EmailEditor(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
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
            <EditorPopover onClose={() => props.onOpenChange(false)}>
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

function EmailError(props: { message: string | undefined }) {
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

/** One address: its pill opens Make primary and Remove. */
function ContactEmailAddress(props: {
  email: string;
  primary: boolean;
  /** The address that ties the contact to its company cannot be removed. */
  linksCompany: boolean;
  change: ChangeEmail;
  errorMessage(error: unknown): string;
  /** Where focus goes once this address is gone. */
  focusAfterRemoval(): void;
}) {
  const [open, setOpen] = createSignal(false);
  const request = createEmailChange(props.change, props.errorMessage);
  let triggerElement: HTMLButtonElement | undefined;
  // Focus starts on the first action so Enter and Tab work without a pointer.
  const [firstAction, setFirstAction] = createSignal<HTMLButtonElement>();
  useSearchInputFocus(firstAction, () => open() && !isTouchDevice());

  const changeOpen = (next: boolean) => {
    if (request.saving()) return;
    if (next) request.clearError();
    setOpen(next);
    if (!next && !isTouchDevice()) triggerElement?.focus();
  };
  const run = async (kind: 'remove' | 'primary') => {
    if (!(await request.run(props.email, kind))) return;
    setOpen(false);
    if (isTouchDevice()) return;
    if (kind === 'remove') props.focusAfterRemoval();
    else triggerElement?.focus();
  };
  const label = () =>
    props.primary
      ? t('crm.primaryContactEmail', { email: props.email })
      : props.email;

  return (
    <EmailEditor
      open={open()}
      onOpenChange={changeOpen}
      title={t('crm.email')}
      anchor={() => triggerElement?.getBoundingClientRect()}
      trigger={
        <Tooltip label={label()}>
          <button
            ref={triggerElement}
            type="button"
            class={propertyPillClasses({
              class: `ph-no-capture ${contactPropertyTouchTarget}`,
            })}
            aria-label={t('crm.manageContactEmail', { email: props.email })}
            aria-expanded={open()}
            aria-haspopup="dialog"
            onClick={() => changeOpen(true)}
          >
            <EnvelopeIcon class="size-3 shrink-0" />
            <span class="truncate">{props.email}</span>
          </button>
        </Tooltip>
      }
    >
      <div
        class="flex min-w-0 flex-col gap-3 p-3"
        role="group"
        aria-label={t('crm.manageContactEmail', { email: props.email })}
        // The hosting menu would otherwise send Tab to its last control.
        on:keydown={(event) => {
          if (event.key === 'Tab') event.stopPropagation();
        }}
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="ph-no-capture min-w-0 flex-1 truncate text-sm">
            {props.email}
          </span>
          <Show when={props.primary}>
            <Badge variant="ghost" size="sm" class="shrink-0">
              {t('crm.primaryEmail')}
            </Badge>
          </Show>
        </div>
        <Show when={props.linksCompany}>
          <p class="text-xs text-ink-muted">
            {t('crm.contactEmailLinksCompany')}
          </p>
        </Show>
        <EmailError message={request.error()} />
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Show when={request.saving()}>
            <span role="status" class="mr-auto text-sm text-ink-muted">
              {t('crm.savingContact')}
            </span>
          </Show>
          <Show when={!props.primary}>
            <Button
              ref={setFirstAction}
              variant="secondary"
              size="sm"
              disabled={request.saving()}
              onClick={() => fireAndForget(run('primary'), 'crm')}
            >
              {t('crm.makePrimaryContactEmail')}
            </Button>
          </Show>
          <Show when={!props.linksCompany}>
            <Button
              ref={props.primary ? setFirstAction : undefined}
              variant="danger-ghost"
              size="sm"
              disabled={request.saving()}
              onClick={() => fireAndForget(run('remove'), 'crm')}
            >
              {t('crm.removeContactEmail')}
            </Button>
          </Show>
        </div>
      </div>
    </EmailEditor>
  );
}

/** The add control: a labelled pill while blank, a plus beside addresses. */
function AddContactEmail(props: {
  blank: boolean;
  change: ChangeEmail;
  errorMessage(error: unknown): string;
  ref(element: HTMLButtonElement): void;
}) {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const request = createEmailChange(props.change, props.errorMessage);
  let triggerElement: HTMLButtonElement | undefined;
  const [emailInput, setEmailInput] = createSignal<HTMLInputElement>();
  useSearchInputFocus(emailInput, () => open() && !isTouchDevice());

  const changeOpen = (next: boolean) => {
    if (request.saving()) return;
    if (next) {
      setDraft('');
      request.clearError();
    }
    setOpen(next);
    if (!next && !isTouchDevice()) triggerElement?.focus();
  };
  const save = async () => {
    if (!(await request.run(draft().trim(), 'add'))) return;
    setOpen(false);
    if (!isTouchDevice()) triggerElement?.focus();
  };

  return (
    <EmailEditor
      open={open()}
      onOpenChange={changeOpen}
      title={t('crm.addEmail')}
      anchor={() => triggerElement?.getBoundingClientRect()}
      trigger={
        <Tooltip label={t('crm.addEmail')}>
          <button
            ref={(element) => {
              triggerElement = element;
              props.ref(element);
            }}
            type="button"
            class={propertyPillClasses({
              empty: true,
              class: contactPropertyTouchTarget,
            })}
            aria-label={t('crm.addEmail')}
            aria-expanded={open()}
            aria-haspopup="dialog"
            onClick={() => changeOpen(true)}
          >
            <Show
              when={props.blank}
              fallback={<PlusIcon class="size-3 shrink-0" />}
            >
              <EnvelopeIcon class="size-3 shrink-0" />
              <span class="truncate">{t('crm.addEmail')}</span>
            </Show>
          </button>
        </Tooltip>
      }
    >
      <form
        class="flex min-w-0 flex-col gap-3 p-3"
        aria-label={t('crm.addEmail')}
        on:keydown={(event) => {
          if (event.key === 'Tab') event.stopPropagation();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          fireAndForget(save(), 'crm');
        }}
      >
        <Input
          ref={setEmailInput}
          type="email"
          required
          aria-label={t('crm.email')}
          placeholder={t('crm.contactEmailPlaceholder')}
          value={draft()}
          readOnly={request.saving()}
          autocomplete="off"
          spellcheck={false}
          data-1p-ignore
          class="ph-no-capture"
          onInput={(event) => {
            setDraft(event.currentTarget.value);
            request.clearError();
          }}
        />
        <EmailError message={request.error()} />
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={request.saving()}
            onClick={() => changeOpen(false)}
          >
            {t('crm.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={request.saving()}
          >
            {request.saving() ? t('crm.savingContact') : t('crm.saveContact')}
          </Button>
        </div>
      </form>
    </EmailEditor>
  );
}

/**
 * Every address of a contact, primary first. Each address opens its own
 * actions and a trailing control adds another. Without the server's address
 * list the addresses stay read-only and only a blank contact can add one.
 */
export function ContactEmailProperty(props: {
  emails: string[];
  primary: string | null | undefined;
  /** Whether the server listed the addresses, so they can be managed. */
  manageable: boolean;
  /** The one address on the company's domain, while the contact is linked. */
  companyEmail: string | undefined;
  change: ChangeEmail;
  errorMessage(error: unknown, change: ContactEmailChange): string;
}) {
  let addElement: HTMLButtonElement | undefined;

  return (
    <div class="flex min-w-0 max-w-full flex-wrap items-center gap-1">
      <For each={props.emails}>
        {(email) => (
          <Show
            when={props.manageable}
            fallback={
              <Badge variant="ghost" size="sm" class="min-w-0 max-w-full">
                <EnvelopeIcon class="size-3 shrink-0" />
                <span class="ph-no-capture truncate">{email}</span>
              </Badge>
            }
          >
            <ContactEmailAddress
              email={email}
              primary={email === props.primary}
              linksCompany={email === props.companyEmail}
              change={props.change}
              errorMessage={(error) => props.errorMessage(error, 'remove')}
              focusAfterRemoval={() => addElement?.focus()}
            />
          </Show>
        )}
      </For>
      <Show when={props.manageable || props.emails.length === 0}>
        <AddContactEmail
          blank={props.emails.length === 0}
          change={props.change}
          errorMessage={(error) => props.errorMessage(error, 'add')}
          ref={(element) => {
            addElement = element;
          }}
        />
      </Show>
    </div>
  );
}
