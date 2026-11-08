import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { useSearchInputFocus } from '@property/utils';
import { Badge, Button, Dialog, Dropdown, Input, Tooltip } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { contactPropertyTouchTarget } from './contact-property-styles';

/** Adds a missing email; populated addresses remain read-only. */
export function ContactEmailProperty(props: {
  email: string | null | undefined;
  save(email: string): Promise<void>;
  errorMessage(error: unknown): string;
}) {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let triggerElement: HTMLButtonElement | undefined;
  let valueElement: HTMLSpanElement | undefined;
  const [emailInput, setEmailInput] = createSignal<HTMLInputElement>();
  useSearchInputFocus(emailInput, () => open() && !isTouchDevice());
  let active = true;
  onCleanup(() => {
    active = false;
  });

  const changeOpen = (next: boolean) => {
    if (saving() || props.email) return;
    if (next) {
      setDraft(props.email ?? '');
      setError(undefined);
    }
    setOpen(next);
    if (!next && !isTouchDevice()) triggerElement?.focus();
  };
  const save = async (value: string) => {
    if (saving() || props.email) return;
    setSaving(true);
    setError(undefined);
    try {
      await props.save(value);
      if (active) {
        setOpen(false);
        if (!isTouchDevice()) (valueElement ?? triggerElement)?.focus();
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
        fireAndForget(save(draft().trim()), 'crm');
      }}
    >
      <Input
        ref={setEmailInput}
        type="email"
        required
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
      when={!props.email}
      fallback={
        <Badge
          ref={valueElement}
          tabIndex={-1}
          variant="ghost"
          size="sm"
          class="min-w-0 max-w-full focus-visible:ring-2 focus-visible:ring-accent/20"
        >
          <EnvelopeIcon class="size-3 shrink-0" />
          <span class="truncate">{props.email}</span>
        </Badge>
      }
    >
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
    </Show>
  );
}
