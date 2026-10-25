import { ViewBreadcrumbs } from '@app/components/view-shell';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel } from '@components/app/side-panel';
import { EntityIcon } from '@core/component/EntityIcon';
import {
  createParamsState,
  ParamsProvider,
} from '@core/component/ParamsProvider';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  ErrorBoundary,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { RecordTabs } from '../components/record-tabs';
import { useCrmContext } from '../context/crm-context';
import type { CrmCommentTarget } from '../context/workspace-context';
import {
  COMPANY_SECTIONS,
  CONTACT_SECTIONS,
  type CompanySection,
  type ContactSection,
  type CrmRecordRef,
  type CrmRecordSection,
} from '../core/record';
import { Company } from './company-detail';
import { Contact } from './contact-detail';
import { CrmCopyLinkButton } from './copy-link-button';
import { useCompanyQuery, useContactQuery } from './use-crm';

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

function sectionOf<T extends CrmRecordSection>(
  sections: readonly T[],
  section: CrmRecordSection | undefined
): T {
  return sections.find((candidate) => candidate === section) ?? sections[0]!;
}

/**
 * Records opened inside the CRM workspace. Each opened record appends a
 * breadcrumb after the originating view; reopening one already in the trail
 * returns to it.
 */
export function CrmRecordDetail(props: {
  /** Opened records, oldest first; the last one is shown. */
  records: readonly CrmRecordRef[];
  section: CrmRecordSection | undefined;
  commentTarget?: CrmCommentTarget;
  viewName: string;
  onOpen: (records: readonly CrmRecordRef[]) => void;
  onSectionChange: (section: CrmRecordSection) => void;
  onClose: () => void;
  navigation: JSX.Element;
  onOpenPipeline?: (pipelineId: string) => void;
}) {
  const trail = () => props.records;
  // Each navigation brings new record objects; only another record remounts.
  const current = createMemo(() => trail()[trail().length - 1]!, undefined, {
    equals: (left, right) => recordKey(left) === recordKey(right),
  });
  // Keep the selected identity available even if the detail body shows an error.
  onCleanup(useCrmContext().registerTaskComposerRecord(current));
  const companySection = (): CompanySection =>
    sectionOf(COMPANY_SECTIONS, props.section);
  const contactSection = (): ContactSection =>
    sectionOf(CONTACT_SECTIONS, props.section);
  const returnTo = (index: number) => {
    if (index === trail().length - 1) return;
    props.onOpen(trail().slice(0, index + 1));
  };
  const open = (record: CrmRecordRef) => {
    const index = trail().findIndex(
      (entry) => recordKey(entry) === recordKey(record)
    );
    if (index !== -1) return returnTo(index);
    props.onOpen([...trail(), record]);
  };
  const back = () =>
    trail().length > 1 ? returnTo(trail().length - 2) : props.onClose();
  let container: HTMLDivElement | undefined;
  const size = createElementSize(() => container);
  const compactTabs = () => !isTouchDevice() && (size.width ?? 0) < 900;
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
      <For each={trail().map(recordKey)}>
        {(key, index) => {
          const record = untrack(
            () => trail().find((entry) => recordKey(entry) === key)!
          );
          const name = createRecordName(record);
          return (
            <ViewBreadcrumbs.Item
              value={key}
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
          <div class="flex h-12 min-w-0 shrink-0 items-center gap-2 px-3 touch:gap-3 touch:border-b touch:border-edge-muted touch:px-4 touch:h-auto touch:min-h-12 touch:pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.5rem)] touch:pb-2">
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
                    compact={compactTabs()}
                    value={companySection()}
                    onChange={props.onSectionChange}
                  />
                }
              >
                <RecordTabs
                  sections={CONTACT_SECTIONS}
                  compact={compactTabs()}
                  value={contactSection()}
                  onChange={props.onSectionChange}
                />
              </Show>
            </div>
            <div class="ml-auto flex shrink-0 items-center gap-2 touch:gap-1">
              <HeaderActionGroup label="Sharing">
                <CrmCopyLinkButton type={current().type} id={current().id} />
              </HeaderActionGroup>
              <SidePanel.Toggle />
            </div>
          </div>
          <div class="relative min-h-0 min-w-0 flex-1 touch:[--mobile-content-inset-top:0px]">
            <Show when={current()} keyed>
              {(record) => (
                <RecordContent
                  record={record}
                  nested={trail().length > 1}
                  commentTarget={props.commentTarget}
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
                        onOpenPipeline={props.onOpenPipeline}
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
                      onOpenPipeline={props.onOpenPipeline}
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
  commentTarget: CrmCommentTarget | undefined;
  onBack: () => void;
  children: JSX.Element;
}) {
  const query =
    props.record.type === 'company'
      ? useCompanyQuery(() => props.record.id).query
      : useContactQuery(() => props.record.id);
  // The Discussion reads its linked message from these params; each request,
  // a new `seek`, scrolls to it again.
  const params = createParamsState();
  createEffect(
    on(
      () =>
        props.commentTarget &&
        `${props.commentTarget.commentId}:${props.commentTarget.seek}`,
      () => {
        const target = untrack(() => props.commentTarget);
        // Without a target, a remounted Discussion must not show the last one.
        params.navigate(
          target ? { [COMMENT_LINK_PARAM]: target.commentId } : {}
        );
      }
    )
  );
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
      <Show
        when={!query.isError}
        fallback={error(() => fireAndForget(query.refetch(), 'crm'))}
      >
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
          <ParamsProvider state={params}>{props.children}</ParamsProvider>
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
