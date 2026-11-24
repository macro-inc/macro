import { t } from '@app/lib/i18n';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { PropertyEmpty } from '@property/extractors/PropertyEmpty';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { Button, ButtonGroup, ConfirmDialog, Dialog, Dropdown } from '@ui';
import { createSignal, onCleanup, Show, Suspense } from 'solid-js';
import { contactPropertyTouchTarget } from './contact-property-styles';

/**
 * A singleton company relation drawn like a task's Project: one split pill
 * whose name opens the company and whose caret changes it. `editable` offers
 * link and switch; `removable` offers Remove company, which asks for
 * confirmation before it saves. Without either the caret is hidden. No company
 * shows the empty property, which opens the picker when one can be linked.
 */
export function ContactCompanyProperty(props: {
  /** The header draws property pills framed; Record details draws them ghost. */
  surface: 'header' | 'details';
  companyId: string | null | undefined;
  companyName: string | undefined;
  editable: boolean;
  removable: boolean;
  /** Why a linked company can be neither switched nor removed. */
  lockedReason: string | undefined;
  /** Null removes the company. */
  save(companyId: string | null): Promise<void>;
  /**
   * Opens the company from its name. The press keeps focus where it is, so
   * the split showing the company stays active once the router hands it over.
   */
  openCompany: {
    onMouseDown(event: MouseEvent): void;
    onClick(event: MouseEvent): void;
  };
  errorMessage(error: unknown): string;
}) {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = createSignal(false);
  const [removalError, setRemovalError] = createSignal<string>();
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let triggerElement: HTMLButtonElement | undefined;
  let valueElement: HTMLElement | undefined;
  let active = true;
  onCleanup(() => {
    active = false;
  });

  const removable = () => props.removable && !!props.companyId;
  const actionable = () => props.editable || removable();
  const changeOpen = (next: boolean) => {
    if (saving() || !actionable()) return;
    if (next) {
      setDraft(props.companyId ?? null);
      setError(undefined);
    }
    setOpen(next);
    if (!next && !isTouchDevice()) triggerElement?.focus();
  };
  // A removal can leave a read-only value where the trigger was.
  const focusValue = () =>
    (triggerElement?.isConnected ? triggerElement : valueElement)?.focus();
  const save = async (companyId: string) => {
    if (saving() || !props.editable) return;
    setDraft(companyId);
    setSaving(true);
    setError(undefined);
    try {
      await props.save(companyId);
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
  // The editor closes first: the confirmation is its own dialog, and a
  // rejection stays in it so the relation on screen is never ahead of the server.
  const confirmRemoval = () => {
    if (saving() || !removable()) return;
    setOpen(false);
    setRemovalError(undefined);
    setConfirmingRemoval(true);
  };
  const remove = async () => {
    if (saving() || !removable()) return;
    setSaving(true);
    setRemovalError(undefined);
    try {
      await props.save(null);
      if (active) setConfirmingRemoval(false);
    } catch (cause) {
      if (active) setRemovalError(props.errorMessage(cause));
    } finally {
      if (active) setSaving(false);
    }
  };
  const select = (ids: Set<string>) => {
    const selected = ids.values().next().value;
    // Choosing the current company is not an implicit unlink.
    if (!selected || saving()) return;
    setDraft(selected);
    setError(undefined);
    if (!isTouchDevice()) fireAndForget(save(selected), 'crm');
  };
  const editor = () => (
    <>
      <Show when={!props.editable}>
        <p class="ph-no-capture truncate px-3 pt-3 text-sm">
          {props.companyName ?? t('crm.company')}
        </p>
      </Show>
      <Show when={props.editable}>
        <div
          inert={saving()}
          class="flex min-h-0 flex-1 flex-col"
          classList={{ 'opacity-50': saving() }}
        >
          <Suspense
            fallback={
              <p role="status" class="p-3 text-sm text-ink-muted">
                {t('crm.loadingCompanies')}
              </p>
            }
          >
            <PropertyEntitySelector
              config={{
                specificEntityType: 'COMPANY',
                isMultiSelect: false,
                placeholder: t('crm.searchCompanies'),
                fillHeight: isTouchDevice(),
              }}
              selectedOptions={() => new Set(draft() ? [draft()!] : [])}
              setSelectedOptions={select}
              onCancel={() => changeOpen(false)}
            />
          </Suspense>
        </div>
      </Show>
      <Show when={error()}>
        {(message) => (
          <p role="alert" class="px-3 py-2 text-sm text-failure">
            {message()}
          </p>
        )}
      </Show>
      <div
        class="flex flex-wrap items-center justify-between gap-2 p-2"
        classList={{ 'border-t border-edge-muted': props.editable }}
        on:keydown={(event) => event.stopPropagation()}
      >
        <Show when={removable()}>
          <Button
            variant="danger-ghost"
            size="sm"
            disabled={saving()}
            onClick={confirmRemoval}
          >
            {t('crm.removeCompany')}
          </Button>
        </Show>
        <Show when={saving()}>
          <span role="status" class="text-sm text-ink-muted">
            {t('crm.savingContact')}
          </span>
        </Show>
        <Show when={error() && !isTouchDevice()}>
          <Button
            variant="primary"
            size="sm"
            disabled={saving()}
            onClick={() => {
              const id = draft();
              if (id) fireAndForget(save(id), 'crm');
            }}
          >
            {t('crm.retryContact')}
          </Button>
        </Show>
      </div>
    </>
  );
  const variant = () => (props.surface === 'header' ? 'secondary' : 'ghost');
  const name = () => props.companyName ?? t('crm.company');
  // Touch keeps focus where it was, so the keyboard doesn't rise.
  const keepTouchFocus = (event: Event) => {
    if (isTouchDevice()) event.preventDefault();
  };
  // A button group clips its segments, so on touch they take the group's own
  // 36px height, as a task's Project pill does, rather than a 24px face with a
  // larger target. The name's tooltip gives it in full and, when the company
  // can't change, the reason why.
  const linkedFace = () => (
    <ButtonGroup
      variant={variant()}
      finish={props.surface === 'header' ? 'raised' : undefined}
      size="xs"
      class="min-w-0 max-w-full border-0"
    >
      <ButtonGroup.Button
        ref={valueElement}
        class="group/company-link min-w-0 shrink justify-start gap-1 touch:min-w-11 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/20"
        aria-label={t('entityActions.openEntityNamed', { name: name() })}
        tooltip={{
          content: (
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="ph-no-capture text-ink">{name()}</span>
              <Show when={!actionable() && props.lockedReason}>
                {(reason) => <span>{reason()}</span>}
              </Show>
            </span>
          ),
        }}
        onMouseDown={(event: MouseEvent) =>
          props.openCompany.onMouseDown(event)
        }
        onClick={(event: MouseEvent) => props.openCompany.onClick(event)}
      >
        <BuildingsIcon class="size-3 shrink-0 not-touch:group-hover/company-link:hidden not-touch:group-focus-visible/company-link:hidden" />
        <ArrowUpRightIcon class="hidden size-3 shrink-0 not-touch:group-hover/company-link:block not-touch:group-focus-visible/company-link:block" />
        <span class="ph-no-capture min-w-0 max-w-60 truncate">{name()}</span>
      </ButtonGroup.Button>
      <Show when={actionable()}>
        <ButtonGroup.Divider />
        <ButtonGroup.Button
          ref={triggerElement}
          size="icon-xs"
          class="focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/20"
          aria-label={t('crm.editContactCompany')}
          aria-expanded={open()}
          aria-haspopup="dialog"
          onPointerDown={keepTouchFocus}
          onMouseDown={keepTouchFocus}
          onClick={() => changeOpen(true)}
        >
          <CaretDownIcon class="size-3 shrink-0" />
        </ButtonGroup.Button>
      </Show>
    </ButtonGroup>
  );
  const emptyFace = () => (
    <Show
      when={actionable()}
      fallback={
        <span
          ref={valueElement}
          tabIndex={-1}
          class={propertyPillClasses({
            variant: variant(),
            size: 'xs',
            readOnly: true,
            empty: true,
            class:
              'h-6 min-w-0 focus-visible:ring-2 focus-visible:ring-accent/20',
          })}
        >
          <PropertyEmpty label={t('crm.noCompany')} />
        </span>
      }
    >
      <button
        ref={triggerElement}
        type="button"
        class={propertyPillClasses({
          variant: variant(),
          size: 'xs',
          empty: true,
          class: `min-w-0 shrink ${contactPropertyTouchTarget}`,
        })}
        aria-label={t('crm.addCompany')}
        aria-expanded={open()}
        aria-haspopup="dialog"
        onPointerDown={keepTouchFocus}
        onMouseDown={keepTouchFocus}
        onClick={() => changeOpen(true)}
      >
        <PropertyEmpty
          label={
            props.surface === 'header' ? t('crm.company') : t('crm.noCompany')
          }
        />
      </button>
    </Show>
  );
  const face = () => (
    <Show when={props.companyId} fallback={emptyFace()}>
      {linkedFace()}
    </Show>
  );
  return (
    <div class="flex min-w-0 max-w-full items-center">
      <Show when={actionable()} fallback={face()}>
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
              {face()}
              <Show when={open()}>
                <EditorPopover onClose={() => changeOpen(false)}>
                  {editor()}
                </EditorPopover>
              </Show>
            </Dropdown>
          }
        >
          {face()}
          <Show when={!props.editable && open()}>
            <Dialog
              open
              onOpenChange={changeOpen}
              onEscapeKeyDown={(event) => {
                event.preventDefault();
                changeOpen(false);
              }}
            >
              <Dialog.Title class="px-3 pt-3 text-base font-semibold">
                {t('crm.company')}
              </Dialog.Title>
              {editor()}
            </Dialog>
          </Show>
          <PickerSheet.Root
            open={open() && props.editable}
            onCancel={() => changeOpen(false)}
          >
            <div on:keydown={(event) => event.stopPropagation()}>
              <PickerSheet.Header
                title={t('crm.company')}
                onDone={() => {
                  const id = draft();
                  if (id) fireAndForget(save(id), 'crm');
                }}
                doneDisabled={saving() || !draft()}
              />
            </div>
            <PickerSheet.Body>{editor()}</PickerSheet.Body>
          </PickerSheet.Root>
        </Show>
      </Show>
      <ConfirmDialog
        open={confirmingRemoval()}
        onOpenChange={(next) => {
          setConfirmingRemoval(next);
          if (!next) setRemovalError(undefined);
        }}
        onCloseAutoFocus={(event) => {
          if (isTouchDevice()) return;
          event.preventDefault();
          focusValue();
        }}
        tone="danger"
        title={t('crm.removeCompanyTitle')}
        confirmLabel={t('crm.removeCompany')}
        cancelLabel={t('crm.cancel')}
        pending={saving()}
        onConfirm={() => fireAndForget(remove(), 'crm')}
        body={
          <>
            {t('crm.removeCompanyBody')}
            <Show when={removalError()}>
              {(message) => (
                <p role="alert" class="mt-3 text-failure">
                  {message()}
                </p>
              )}
            </Show>
          </>
        }
      />
    </div>
  );
}
