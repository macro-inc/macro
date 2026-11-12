import { t } from '@app/lib/i18n';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { Badge, Button, Dialog, Dropdown, Tooltip } from '@ui';
import { createSignal, onCleanup, Show, Suspense } from 'solid-js';
import {
  contactPropertyIconTouchTarget,
  contactPropertyTouchTarget,
} from './contact-property-styles';

/**
 * A singleton company relation with separate edit and navigation actions.
 * `editable` offers link and switch; `removable` offers Remove company.
 */
export function ContactCompanyProperty(props: {
  companyId: string | null | undefined;
  companyName: string | undefined;
  editable: boolean;
  removable: boolean;
  /** Why a linked company can be neither switched nor removed. */
  lockedReason: string | undefined;
  /** Null removes the company. */
  save(companyId: string | null): Promise<void>;
  openCompany(event: MouseEvent): void;
  errorMessage(error: unknown): string;
}) {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<string | null>(null);
  // The last save requested: Retry repeats a link or switch, never a removal.
  const [attempt, setAttempt] = createSignal<{ companyId: string | null }>();
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let triggerElement: HTMLButtonElement | undefined;
  let valueElement: HTMLSpanElement | undefined;
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
  const save = async (companyId: string | null) => {
    if (saving()) return;
    if (companyId ? !props.editable : !removable()) return;
    if (companyId) setDraft(companyId);
    setAttempt({ companyId });
    setSaving(true);
    setError(undefined);
    try {
      await props.save(companyId);
      if (active) {
        setOpen(false);
        // A removal can leave a read-only value where the trigger was.
        if (!isTouchDevice())
          (triggerElement?.isConnected
            ? triggerElement
            : valueElement
          )?.focus();
      }
    } catch (cause) {
      if (active) setError(props.errorMessage(cause));
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
            onClick={() => fireAndForget(save(null), 'crm')}
          >
            {t('crm.removeCompany')}
          </Button>
        </Show>
        <Show when={saving()}>
          <span role="status" class="text-sm text-ink-muted">
            {t('crm.savingContact')}
          </span>
        </Show>
        <Show when={error() && !isTouchDevice() && attempt()?.companyId}>
          <Button
            variant="primary"
            size="sm"
            disabled={saving()}
            onClick={() => {
              const id = attempt()?.companyId;
              if (id) fireAndForget(save(id), 'crm');
            }}
          >
            {t('crm.retryContact')}
          </Button>
        </Show>
      </div>
    </>
  );
  const trigger = () => (
    <Tooltip
      label={
        props.companyName ??
        (props.companyId ? t('crm.company') : t('crm.addCompany'))
      }
    >
      <button
        ref={triggerElement}
        type="button"
        class={propertyPillClasses({
          empty: !props.companyId,
          class: `min-w-0 shrink ${contactPropertyTouchTarget}`,
        })}
        aria-label={
          props.companyId ? t('crm.editContactCompany') : t('crm.addCompany')
        }
        aria-expanded={open()}
        aria-haspopup="dialog"
        onPointerDown={(event) => {
          if (isTouchDevice()) event.preventDefault();
        }}
        onMouseDown={(event) => {
          if (isTouchDevice()) event.preventDefault();
        }}
        onClick={() => changeOpen(true)}
      >
        <BuildingsIcon class="size-3 shrink-0" />
        <span class="truncate">
          {props.companyName ??
            (props.companyId ? t('crm.company') : t('crm.addCompany'))}
        </span>
      </button>
    </Tooltip>
  );
  return (
    <div class="flex min-w-0 max-w-full items-center gap-1">
      <Show
        when={actionable()}
        fallback={
          <Tooltip
            label={props.lockedReason ?? ''}
            disabled={!props.lockedReason}
          >
            <Badge
              ref={valueElement}
              tabIndex={-1}
              variant="ghost"
              size="sm"
              class="min-w-0 shrink focus-visible:ring-2 focus-visible:ring-accent/20"
            >
              <BuildingsIcon class="size-3 shrink-0" />
              <span class="truncate">
                {props.companyName ??
                  (props.companyId ? t('crm.company') : t('crm.noCompany'))}
              </span>
            </Badge>
          </Tooltip>
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
                  {editor()}
                </EditorPopover>
              </Show>
            </Dropdown>
          }
        >
          {trigger()}
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
      <Show when={props.companyId}>
        <Button
          variant="ghost"
          size="icon-xs"
          class={contactPropertyIconTouchTarget}
          aria-label={t('crm.goToCompany')}
          tooltip={t('crm.goToCompany')}
          onClick={props.openCompany}
        >
          <ArrowSquareOutIcon class="size-3 shrink-0" />
        </Button>
      </Show>
    </div>
  );
}
