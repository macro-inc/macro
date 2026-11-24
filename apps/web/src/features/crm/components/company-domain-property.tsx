import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import GlobeIcon from '@icon/system/regular/globe.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { useSearchInputFocus } from '@property/utils';
import { Badge, Button, buttonClasses, Input, Tooltip } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { CompanyDomainChange } from '../core/company';
import { ValueEditor, ValueError } from './contact-email-property';
import {
  contactPropertyIconTouchTarget,
  contactPropertyTouchTarget,
} from './contact-property-styles';
import { createValueChange } from './value-change';

type ChangeDomain = (
  domain: string,
  change: CompanyDomainChange
) => Promise<void>;

/** One domain: its pill opens Remove. */
function CompanyDomain(props: {
  domain: string;
  primary: boolean;
  change: ChangeDomain;
  errorMessage(error: unknown, change: CompanyDomainChange): string;
  /** Where focus goes once this domain is gone. */
  focusAfterRemoval(): void;
}) {
  const [open, setOpen] = createSignal(false);
  const request = createValueChange(props.change, (error) =>
    props.errorMessage(error, 'remove')
  );
  let triggerElement: HTMLButtonElement | undefined;
  // Focus starts on Remove so Enter and Tab work without a pointer.
  const [removeButton, setRemoveButton] = createSignal<HTMLButtonElement>();
  useSearchInputFocus(removeButton, () => open() && !isTouchDevice());

  const changeOpen = (next: boolean) => {
    if (request.saving()) return;
    if (next) request.clearError();
    setOpen(next);
    if (!next && !isTouchDevice()) triggerElement?.focus();
  };
  const remove = async () => {
    if (!(await request.run(props.domain, 'remove'))) return;
    setOpen(false);
    if (!isTouchDevice()) props.focusAfterRemoval();
  };
  const label = () =>
    props.primary
      ? t('crm.primaryCompanyDomain', { domain: props.domain })
      : props.domain;

  return (
    <ValueEditor
      open={open()}
      onOpenChange={changeOpen}
      title={t('crm.domain')}
      anchor={() => triggerElement?.getBoundingClientRect()}
      trigger={
        <Tooltip label={label()} class="min-w-0 max-w-full">
          <button
            ref={triggerElement}
            type="button"
            class={propertyPillClasses({ class: contactPropertyTouchTarget })}
            aria-label={t('crm.manageCompanyDomain', { domain: props.domain })}
            aria-expanded={open()}
            aria-haspopup="dialog"
            onClick={() => changeOpen(true)}
          >
            <GlobeIcon class="size-3 shrink-0" />
            <span class="truncate">{props.domain}</span>
          </button>
        </Tooltip>
      }
    >
      <div
        class="flex min-w-0 flex-col gap-3 p-3"
        role="group"
        aria-label={t('crm.manageCompanyDomain', { domain: props.domain })}
        // The hosting menu would otherwise send Tab to its last control.
        on:keydown={(event) => {
          if (event.key === 'Tab') event.stopPropagation();
        }}
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-sm">{props.domain}</span>
          <Show when={props.primary}>
            <Badge variant="ghost" size="sm" class="shrink-0">
              {t('crm.primaryDomain')}
            </Badge>
          </Show>
        </div>
        <p class="text-xs text-ink-muted">{t('crm.companyDomainRemoveHelp')}</p>
        <ValueError message={request.error()} />
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Show when={request.saving()}>
            <span role="status" class="mr-auto text-sm text-ink-muted">
              {t('crm.savingContact')}
            </span>
          </Show>
          <Button
            ref={setRemoveButton}
            variant="danger-ghost"
            size="sm"
            disabled={request.saving()}
            onClick={() => fireAndForget(remove(), 'crm')}
          >
            {t('crm.removeCompanyDomain')}
          </Button>
        </div>
      </div>
    </ValueEditor>
  );
}

/**
 * The add control: a labelled pill while the company has no domain, then the
 * property panel's add-value button beside the domains. One element serves
 * both, so focus returned after the first domain is added stays on it.
 */
function AddCompanyDomain(props: {
  blank: boolean;
  change: ChangeDomain;
  errorMessage(error: unknown): string;
  ref(element: HTMLButtonElement): void;
}) {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const request = createValueChange(props.change, props.errorMessage);
  let triggerElement: HTMLButtonElement | undefined;
  const [domainInput, setDomainInput] = createSignal<HTMLInputElement>();
  useSearchInputFocus(domainInput, () => open() && !isTouchDevice());

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
    <ValueEditor
      open={open()}
      onOpenChange={changeOpen}
      title={t('crm.addDomain')}
      anchor={() => triggerElement?.getBoundingClientRect()}
      trigger={
        <Tooltip label={t('crm.addDomain')}>
          <button
            ref={(element) => {
              triggerElement = element;
              props.ref(element);
            }}
            type="button"
            class={
              props.blank
                ? propertyPillClasses({
                    empty: true,
                    class: contactPropertyTouchTarget,
                  })
                : buttonClasses({
                    variant: 'ghost',
                    size: 'icon-xs',
                    class: `text-ink-extra-muted not-data-disabled:focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/20 ${contactPropertyIconTouchTarget}`,
                  })
            }
            aria-label={t('crm.addDomain')}
            aria-expanded={open()}
            aria-haspopup="dialog"
            onClick={() => changeOpen(true)}
          >
            <Show
              when={props.blank}
              fallback={<PlusIcon class="size-3 shrink-0" />}
            >
              <GlobeIcon class="size-3 shrink-0" />
              <span class="truncate">{t('crm.addDomain')}</span>
            </Show>
          </button>
        </Tooltip>
      }
    >
      <form
        class="flex min-w-0 flex-col gap-3 p-3"
        aria-label={t('crm.addDomain')}
        on:keydown={(event) => {
          if (event.key === 'Tab') event.stopPropagation();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          fireAndForget(save(), 'crm');
        }}
      >
        <Input
          ref={setDomainInput}
          type="text"
          inputMode="url"
          required
          aria-label={t('crm.domain')}
          placeholder={t('crm.companyDomainPlaceholder')}
          value={draft()}
          readOnly={request.saving()}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          data-1p-ignore
          onInput={(event) => {
            setDraft(event.currentTarget.value);
            request.clearError();
          }}
        />
        <p class="text-xs text-ink-muted">{t('crm.companyDomainAddHelp')}</p>
        <ValueError message={request.error()} />
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
    </ValueEditor>
  );
}

/**
 * Every domain of a company, primary first. Each domain opens its own
 * Remove, and a trailing control adds another. The domains wrap among
 * themselves, so the add control stays beside the last one.
 */
export function CompanyDomainProperty(props: {
  domains: string[];
  change: ChangeDomain;
  errorMessage(error: unknown, change: CompanyDomainChange): string;
}) {
  let addElement: HTMLButtonElement | undefined;

  return (
    <div
      role="group"
      aria-label={t('crm.domains')}
      class="flex min-w-0 max-w-full items-end gap-1"
    >
      <Show when={props.domains.length > 0}>
        <div class="flex min-w-0 flex-wrap items-center gap-1">
          <For each={props.domains}>
            {(domain, index) => (
              <CompanyDomain
                domain={domain}
                primary={index() === 0}
                change={props.change}
                errorMessage={props.errorMessage}
                focusAfterRemoval={() => addElement?.focus()}
              />
            )}
          </For>
        </div>
      </Show>
      <AddCompanyDomain
        blank={props.domains.length === 0}
        change={props.change}
        errorMessage={(error) => props.errorMessage(error, 'add')}
        ref={(element) => {
          addElement = element;
        }}
      />
    </div>
  );
}
