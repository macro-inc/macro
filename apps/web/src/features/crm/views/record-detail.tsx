import { ViewBreadcrumbs } from '@app/components/view-shell';
import { SidePanel } from '@components/app/side-panel';
import { EntityIcon } from '@core/component/EntityIcon';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button, Tooltip } from '@ui';
import {
  createSignal,
  ErrorBoundary,
  For,
  type JSX,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { RecordTabs } from '../components/record-tabs';
import {
  COMPANY_SECTIONS,
  CONTACT_SECTIONS,
  type CompanySection,
  type ContactSection,
} from '../core/record';
import { Company } from './company-detail';
import { Contact } from './contact-detail';
import { CrmCopyLinkButton } from './copy-link-button';
import { useCompanyQuery, useContactQuery } from './use-crm';

/** A CRM record shown inside the workspace, with its fallback label. */
export type CrmRecordRef = {
  type: 'company' | 'contact';
  id: string;
  name: string;
};

const recordKey = (record: CrmRecordRef) => `${record.type}:${record.id}`;

function createRecordName(record: CrmRecordRef): () => string {
  const fallback =
    record.name || (record.type === 'company' ? 'Company' : 'Contact');
  if (record.type === 'company') {
    const { company } = useCompanyQuery(() => record.id);
    return () => company()?.name ?? fallback;
  }
  const query = useContactQuery(() => record.id);
  return () => {
    const contact = query.isSuccess ? query.data : undefined;
    return contact?.name ?? contact?.email ?? fallback;
  };
}

/**
 * Records opened inside the CRM workspace. Each opened record appends a
 * breadcrumb after the originating view; reopening one already in the trail
 * returns to it.
 */
export function CrmRecordDetail(props: {
  record: CrmRecordRef;
  viewName: string;
  onClose: () => void;
  navigation: JSX.Element;
}) {
  const [trail, setTrail] = createSignal<CrmRecordRef[]>([props.record]);
  const current = () => trail()[trail().length - 1];
  const [companySection, setCompanySection] =
    createSignal<CompanySection>('overview');
  const [contactSection, setContactSection] =
    createSignal<ContactSection>('overview');
  const returnTo = (index: number) =>
    setTrail((records) => records.slice(0, index + 1));
  const open = (record: CrmRecordRef) => {
    const index = trail().findIndex(
      (entry) => recordKey(entry) === recordKey(record)
    );
    if (index !== -1) return returnTo(index);
    if (record.type === 'company') setCompanySection('overview');
    else setContactSection('overview');
    setTrail((records) => [...records, record]);
  };
  const back = () =>
    trail().length > 1 ? returnTo(trail().length - 2) : props.onClose();
  let container: HTMLDivElement | undefined;
  onMount(() => container?.focus());

  return (
    <ViewBreadcrumbs.Root
      value={recordKey(current())}
      onChange={(value) => {
        if (value === 'crm-view') return props.onClose();
        const index = trail().findIndex(
          (record) => recordKey(record) === value
        );
        if (index !== -1) returnTo(index);
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
      <For each={trail()}>
        {(record, index) => {
          const name = createRecordName(record);
          return (
            <ViewBreadcrumbs.Item
              value={recordKey(record)}
              metadata={{ type: record.type, id: record.id }}
              order={index() + 1}
            >
              {(item) => (
                <Tooltip label={name()} class="min-w-0">
                  <ViewBreadcrumbs.Button
                    isActive={item.isActive()}
                    onClick={item.onSelect}
                    class="gap-1.5"
                  >
                    <EntityIcon
                      targetType={
                        record.type === 'company' ? 'crm_company' : 'contact'
                      }
                      size="xs"
                      class="shrink-0"
                    />
                    <span class="truncate">{name()}</span>
                  </ViewBreadcrumbs.Button>
                </Tooltip>
              )}
            </ViewBreadcrumbs.Item>
          );
        }}
      </For>
      <SidePanel.Root floating defaultOpen={false}>
        <div
          ref={container}
          tabindex={-1}
          class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden outline-none"
        >
          <div class="flex h-12 min-w-0 shrink-0 items-center gap-3 border-b border-edge-muted px-4">
            {props.navigation}
            <ViewBreadcrumbs.Outlet
              aria-label="CRM record location"
              class="min-w-0 shrink"
            />
            <div class="min-w-0 overflow-x-auto">
              <Show
                when={current().type === 'contact'}
                fallback={
                  <RecordTabs
                    sections={COMPANY_SECTIONS}
                    value={companySection()}
                    onChange={setCompanySection}
                  />
                }
              >
                <RecordTabs
                  sections={CONTACT_SECTIONS}
                  value={contactSection()}
                  onChange={setContactSection}
                />
              </Show>
            </div>
            <div class="ml-auto flex shrink-0 items-center gap-1">
              <CrmCopyLinkButton type={current().type} id={current().id} />
              <SidePanel.Toggle />
            </div>
          </div>
          <div class="relative min-h-0 min-w-0 flex-1">
            <Show when={current()} keyed>
              {(record) => (
                <RecordContent
                  record={record}
                  nested={trail().length > 1}
                  onBack={back}
                >
                  <Show
                    when={record.type === 'contact'}
                    fallback={
                      <Company
                        companyId={record.id}
                        section={companySection()}
                        headerToggle={false}
                        onHidden={back}
                        onOpenContact={(contact) =>
                          open({
                            type: 'contact',
                            id: contact.id,
                            name: contact.name ?? contact.email,
                          })
                        }
                      />
                    }
                  >
                    <Contact
                      contactId={record.id}
                      section={contactSection()}
                      headerToggle={false}
                      onOpenCompany={(companyId) => {
                        open({ type: 'company', id: companyId, name: '' });
                        return true;
                      }}
                    />
                  </Show>
                </RecordContent>
              )}
            </Show>
          </div>
        </div>
      </SidePanel.Root>
    </ViewBreadcrumbs.Root>
  );
}

function RecordContent(props: {
  record: CrmRecordRef;
  nested: boolean;
  onBack: () => void;
  children: JSX.Element;
}) {
  const query =
    props.record.type === 'company'
      ? useCompanyQuery(() => props.record.id).query
      : useContactQuery(() => props.record.id);
  const error = (onRetry: () => void) => (
    <DetailError
      onRetry={onRetry}
      onBack={props.onBack}
      record={props.record.type}
      nested={props.nested}
    />
  );
  return (
    <ErrorBoundary
      fallback={(cause, reset) => {
        console.error('Failed to render CRM record', cause);
        return error(reset);
      }}
    >
      <Show when={!query.isError} fallback={error(() => void query.refetch())}>
        <Suspense
          fallback={
            <div class="grid size-full place-items-center text-ink-muted">
              <SpinnerIcon
                aria-label={`Loading ${props.record.type}`}
                class="size-5 animate-spin"
              />
            </div>
          }
        >
          {props.children}
        </Suspense>
      </Show>
    </ErrorBoundary>
  );
}

function DetailError(props: {
  onRetry: () => void;
  onBack: () => void;
  record: CrmRecordRef['type'];
  nested: boolean;
}) {
  return (
    <div class="flex size-full flex-col items-center justify-center gap-3 text-sm text-ink-muted">
      <p>This {props.record} couldn’t be loaded.</p>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          Try again
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          {props.nested ? 'Go back' : 'Back to view'}
        </Button>
      </div>
    </div>
  );
}
