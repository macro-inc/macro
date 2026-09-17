import type { CalendarEvent } from '@app/features/calendar/types';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { EntityIcon } from '@core/component/EntityIcon';
import { References } from '@core/component/References';
import type { CrmCompanyEntity } from '@entity';
import { Collapsible } from '@kobalte/core/collapsible';
import AddressBookIcon from '@phosphor/address-book.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
import { For, Show, Suspense } from 'solid-js';
import { useEventDetailsOverlay } from './event-details-overlay';
import { useEventCompanies } from './use-event-companies';

function CompanyRow(props: {
  company: CrmCompanyEntity;
  onOpen: (company: CrmCompanyEntity) => void;
}) {
  const domain = () => props.company.domains[0]?.domain;

  return (
    <button
      type="button"
      class="-mx-1 flex min-w-0 items-center gap-4 rounded-md px-1 py-1 text-left hover:bg-hover sm:gap-3"
      title="Open company record"
      onClick={() => props.onOpen(props.company)}
    >
      <EntityIcon targetType="crm_company" size="md" />
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-ink-muted">{props.company.name}</span>
        <Show when={domain() !== undefined && domain() !== props.company.name}>
          <span class="truncate text-xs text-ink-extra-muted sm:text-xxs">
            {domain()}
          </span>
        </Show>
      </span>
    </button>
  );
}

/**
 * The records an event connects to: the CRM companies its guests belong to,
 * and the documents and messages that mention the event (its References, as
 * tasks have). Hidden while there is nothing to show, so an internal meeting
 * nobody has written about takes no space.
 */
export function EventRecordsSection(props: { event: CalendarEvent }) {
  const overlay = useEventDetailsOverlay();
  const { openWithSplit } = useSplitLayout();
  const companies = useEventCompanies(() => props.event);
  const references = useAttachmentReferencesQuery(
    () => props.event.eventId,
    () => 'calendar_event'
  );
  const referenceCount = () =>
    references.isSuccess ? references.data.length : 0;
  const hasRecords = () => companies().length > 0 || referenceCount() > 0;

  const openCompany = (company: CrmCompanyEntity) => {
    overlay.close();
    openWithSplit(
      { type: 'company', id: company.id },
      { preferNewSplit: true, activate: true }
    );
  };

  return (
    <Show when={hasRecords()}>
      <Collapsible
        defaultOpen
        class="border-edge-muted border-t text-sm text-ink-muted sm:text-xs"
      >
        <Collapsible.Trigger class="group flex w-full min-w-0 items-center gap-4 py-4 pl-4 pr-2 text-left hover:bg-hover hover:text-ink sm:gap-3">
          <AddressBookIcon class="size-5 shrink-0 text-ink-extra-muted sm:size-4" />
          <span>Records</span>
          <CaretDownIcon
            aria-hidden="true"
            class="size-3 shrink-0 -rotate-90 text-ink-extra-muted transition-transform group-data-expanded:rotate-0"
          />
        </Collapsible.Trigger>
        <Collapsible.Content class="data-closed:hidden">
          <div class="flex gap-4 pb-3 pl-4 pr-4 pt-1.5 sm:gap-3">
            <span aria-hidden="true" class="size-5 shrink-0 sm:size-4" />
            <div class="flex min-w-0 flex-1 flex-col gap-3">
              <Show when={companies().length > 0}>
                <div class="flex flex-col gap-1">
                  <For each={companies()}>
                    {(company) => (
                      <CompanyRow company={company} onOpen={openCompany} />
                    )}
                  </For>
                </div>
              </Show>
              <Show when={referenceCount() > 0}>
                <div class="flex flex-col gap-1.5">
                  <span class="text-xs text-ink-extra-muted sm:text-xxs">
                    References ({referenceCount()})
                  </span>
                  {/* Opening a reference navigates away, so the details go too. */}
                  <div class="text-xs" onClick={() => overlay.close()}>
                    <Suspense
                      fallback={
                        <div class="py-2 text-ink-extra-muted">Loading…</div>
                      }
                    >
                      <References
                        documentId={props.event.eventId}
                        entityType="calendar_event"
                      />
                    </Suspense>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  );
}
