import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { useSearchInputFocus } from '@property/utils';
import { Button, Dialog, Dropdown, Input, Tooltip } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { contactPropertyTouchTarget } from './contact-property-styles';

/** Edits the contact's existing email; the saved value changes only on success. */
export function ContactEmailProperty(props: {
  email: string | null | undefined;
  save(email: string | null): Promise<void>;
  errorMessage(error: unknown): string;
}) {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let triggerElement: HTMLButtonElement | undefined;
  const [emailInput, setEmailInput] = createSignal<HTMLInputElement>();
  useSearchInputFocus(emailInput, () => open() && !isTouchDevice());
  let active = true;
  onCleanup(() => {
    active = false;
  });

  const changeOpen = (next: boolean) => {
    if (saving()) return;
    if (next) {
      setDraft(props.email ?? '');
      setError(undefined);
    }
    setOpen(next);
    if (!next && !isTouchDevice()) triggerElement?.focus();
  };
  const save = async (value: string | null) => {
    if (saving()) return;
    setSaving(true);
    setError(undefined);
    try {
      await props.save(value);
      if (active) {
        setOpen(false);
        if (!isTouchDevice()) triggerElement?.focus();
      }
    } catch (cause) {
      if (active) setError(props.errorMessage(cause));
    } finally {
      if (active) setSaving(false);
    }
  };
  const form = () => (
    <form
      class="flex min-w-0 flex-col gap-3 p-3"
      aria-label={t('crm.editContactEmail')}
      onSubmit={(event) => {
        event.preventDefault();
        fireAndForget(save(draft().trim() || null), 'crm');
      }}
    >
      <Input
        ref={setEmailInput}
        type="email"
        aria-label={t('crm.email')}
        placeholder={t('crm.contactEmailPlaceholder')}
        value={draft()}
        readOnly={saving()}
        autocomplete="off"
        spellcheck={false}
        data-1p-ignore
        class="ph-no-capture"
        onInput={(event) => {
          setDraft(event.currentTarget.value);
          setError(undefined);
        }}
      />
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="text-sm text-failure">
            {message()}
          </p>
        )}
      </Show>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <Show when={props.email}>
          <Button
            variant="ghost"
            size="sm"
            disabled={saving()}
            onClick={() => fireAndForget(save(null), 'crm')}
          >
            {t('crm.removeEmail')}
          </Button>
        </Show>
        <Button
          variant="ghost"
          size="sm"
          disabled={saving()}
          onClick={() => changeOpen(false)}
        >
          {t('crm.cancel')}
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={saving()}>
          {saving() ? t('crm.savingContact') : t('crm.saveContact')}
        </Button>
      </div>
    </form>
  );
  const trigger = () => (
    <Tooltip label={props.email ?? t('crm.addEmail')}>
      <button
        ref={triggerElement}
        type="button"
        class={propertyPillClasses({
          empty: !props.email,
          class: contactPropertyTouchTarget,
        })}
        aria-label={props.email ? t('crm.editContactEmail') : t('crm.addEmail')}
        aria-expanded={open()}
        aria-haspopup="dialog"
        onClick={() => changeOpen(true)}
      >
        <EnvelopeIcon class="size-3 shrink-0" />
        <span class="truncate">{props.email ?? t('crm.addEmail')}</span>
      </button>
    </Tooltip>
  );
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dropdown
          open={open()}
          onOpenChange={changeOpen}
          getAnchorRect={() => triggerElement?.getBoundingClientRect()}
          placement="bottom-start"
          fitViewport
        >
          {trigger()}
          <Show when={open()}>
            <EditorPopover onClose={() => changeOpen(false)}>
              {form()}
            </EditorPopover>
          </Show>
        </Dropdown>
      }
    >
      {trigger()}
      <Show when={open()}>
        <Dialog
          open
          onOpenChange={changeOpen}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            changeOpen(false);
          }}
        >
          <Dialog.Title class="px-3 pt-3 text-base font-semibold">
            {t('crm.editContactEmail')}
          </Dialog.Title>
          {form()}
        </Dialog>
      </Show>
    </Show>
  );
}
