import { ViewBreadcrumbs } from '@app/components/view-shell';
import { Contact } from '@app/features/contacts/Contact/Contact';
import { SidePanel } from '@components/app/side-panel';
import { EntityIcon } from '@core/component/EntityIcon';
import SpinnerIcon from '@phosphor/spinner.svg';
import { type CompanyContact, useCompanyQuery } from '@queries/crm/companies';
import { useContactQuery } from '@queries/crm/contacts';
import { Button, Tooltip } from '@ui';
import {
  createSignal,
  ErrorBoundary,
  type JSX,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { Company } from '../Company/Company';
import { CrmCopyLinkButton } from '../components/CrmCopyLinkButton';

export function CrmCompanyDetail(props: {
  company: { id: string; name: string };
  viewName: string;
  onClose: () => void;
  navigation: JSX.Element;
}) {
  const { query, company } = useCompanyQuery(() => props.company.id);
  const companyName = () => company()?.name ?? props.company.name;
  const [selectedContact, setSelectedContact] = createSignal<CompanyContact>();
  const contactQuery = useContactQuery(() => selectedContact()?.id ?? '');
  const contactName = () => {
    const contact = contactQuery.isSuccess
      ? contactQuery.data
      : selectedContact();
    return contact?.name ?? contact?.email ?? 'Contact';
  };
  const closeContact = () => setSelectedContact(undefined);
  const activeQuery = () => (selectedContact() ? contactQuery : query);
  const closeDetail = () =>
    selectedContact() ? closeContact() : props.onClose();
  let container: HTMLDivElement | undefined;
  onMount(() => container?.focus());

  return (
    <ViewBreadcrumbs.Root
      value={
        selectedContact()
          ? `contact:${selectedContact()!.id}`
          : `company:${props.company.id}`
      }
      onChange={(value) => {
        if (value === 'crm-view') props.onClose();
        if (value === `company:${props.company.id}`) closeContact();
      }}
    >
      <ViewBreadcrumbs.Item
        value="crm-view"
        metadata={{ type: 'companies' }}
        order={0}
      >
        {(item) => (
          <Tooltip label={`Back to ${props.viewName}`} class="min-w-0">
            <ViewBreadcrumbs.Button
              isActive={item.isActive()}
              onClick={item.onSelect}
            >
              <span class="truncate">{props.viewName}</span>
            </ViewBreadcrumbs.Button>
          </Tooltip>
        )}
      </ViewBreadcrumbs.Item>
      <ViewBreadcrumbs.Item
        value={`company:${props.company.id}`}
        metadata={{ type: 'company', id: props.company.id }}
        order={1}
      >
        {(item) => (
          <Tooltip label={companyName()} class="min-w-0">
            <ViewBreadcrumbs.Button
              isActive={item.isActive()}
              onClick={item.onSelect}
              class="gap-1.5"
            >
              <EntityIcon targetType="crm_company" size="xs" class="shrink-0" />
              <span class="truncate">{companyName()}</span>
            </ViewBreadcrumbs.Button>
          </Tooltip>
        )}
      </ViewBreadcrumbs.Item>
      <Show when={selectedContact()}>
        {(contact) => (
          <ViewBreadcrumbs.Item
            value={`contact:${contact().id}`}
            metadata={{ type: 'contact', id: contact().id }}
            order={2}
          >
            {(item) => (
              <Tooltip label={contactName()} class="min-w-0">
                <ViewBreadcrumbs.Button
                  isActive={item.isActive()}
                  onClick={item.onSelect}
                  class="gap-1.5"
                >
                  <EntityIcon targetType="contact" size="xs" class="shrink-0" />
                  <span class="truncate">{contactName()}</span>
                </ViewBreadcrumbs.Button>
              </Tooltip>
            )}
          </ViewBreadcrumbs.Item>
        )}
      </Show>
      <SidePanel.Root persistKey="crm-company">
        <div
          ref={container}
          tabindex={-1}
          class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden outline-none"
        >
          <div class="flex h-12 min-w-0 shrink-0 items-center gap-3 border-b border-edge-muted px-4">
            {props.navigation}
            <ViewBreadcrumbs.Outlet
              aria-label="CRM record location"
              class="flex-1"
            />
            <div class="ml-auto flex shrink-0 items-center gap-2">
              <CrmCopyLinkButton
                type={selectedContact() ? 'contact' : 'company'}
                id={selectedContact()?.id ?? props.company.id}
              />
              <SidePanel.Toggle />
            </div>
          </div>
          <div class="relative min-h-0 min-w-0 flex-1">
            <Show when={selectedContact()?.id ?? props.company.id} keyed>
              {(_recordId) => (
                <ErrorBoundary
                  fallback={(error, reset) => {
                    console.error('Failed to render CRM record', error);
                    return (
                      <DetailError
                        onRetry={reset}
                        onClose={closeDetail}
                        isContact={!!selectedContact()}
                      />
                    );
                  }}
                >
                  <Show
                    when={!activeQuery().isError}
                    fallback={
                      <DetailError
                        onRetry={() => void activeQuery().refetch()}
                        onClose={closeDetail}
                        isContact={!!selectedContact()}
                      />
                    }
                  >
                    <Suspense
                      fallback={
                        <div class="grid size-full place-items-center text-ink-muted">
                          <SpinnerIcon
                            aria-label={
                              selectedContact()
                                ? 'Loading contact'
                                : 'Loading company'
                            }
                            class="size-5 animate-spin"
                          />
                        </div>
                      }
                    >
                      <Show
                        when={selectedContact()}
                        fallback={
                          <Company
                            companyId={props.company.id}
                            headerToggle={false}
                            onHidden={props.onClose}
                            onOpenContact={setSelectedContact}
                          />
                        }
                      >
                        {(contact) => (
                          <Contact
                            contactId={contact().id}
                            headerToggle={false}
                            onOpenCompany={(companyId) => {
                              if (companyId !== props.company.id) return false;
                              closeContact();
                              return true;
                            }}
                          />
                        )}
                      </Show>
                    </Suspense>
                  </Show>
                </ErrorBoundary>
              )}
            </Show>
          </div>
        </div>
      </SidePanel.Root>
    </ViewBreadcrumbs.Root>
  );
}

function DetailError(props: {
  onRetry: () => void;
  onClose: () => void;
  isContact: boolean;
}) {
  return (
    <div class="flex size-full flex-col items-center justify-center gap-3 text-sm text-ink-muted">
      <p>This {props.isContact ? 'contact' : 'company'} couldn’t be loaded.</p>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          Try again
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onClose}>
          {props.isContact ? 'Back to company' : 'Back to view'}
        </Button>
      </div>
    </div>
  );
}
