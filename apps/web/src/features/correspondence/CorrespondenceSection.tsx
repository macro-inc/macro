import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import {
  ListEntity,
  ListEntityMetadataQueryProvider,
  ListLayoutProvider,
} from '@entity';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import type { CompanyContact } from '@queries/crm/companies';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';
import {
  type CorrespondenceParty,
  type CorrespondencePartyGroup,
  groupPartiesByDomain,
} from './parties';
import {
  CORRESPONDENCE_THREAD_LIMIT,
  useCorrespondenceThreadsQuery,
} from './use-correspondence-threads';
import { useCrmCompanyForDomain } from './use-crm-records';

/**
 * The "Correspondence" side-panel section: who the external parties on the
 * current email thread / calendar event are, the company they belong to, and
 * the recent email history with them.
 *
 * Renders nothing when `parties` is empty, which is how the "external parties
 * only" rule is enforced — callers pass the output of
 * {@link import('./parties').externalParties}.
 */
export function CorrespondenceSidePanelSection(props: {
  parties: CorrespondenceParty[];
  /** Render order within the panel — lower numbers appear first. */
  order?: number;
}) {
  return (
    <Show when={props.parties.length > 0}>
      <SidePanel.Section
        id="correspondence"
        title={
          <SidePanel.CountTitle
            label="Correspondence"
            count={props.parties.length}
          />
        }
        order={props.order}
        defaultOpen
      >
        <CorrespondenceContent parties={props.parties} />
      </SidePanel.Section>
    </Show>
  );
}

function CorrespondenceContent(props: { parties: CorrespondenceParty[] }) {
  const groups = createMemo(() => groupPartiesByDomain(props.parties));
  const addresses = createMemo(() => props.parties.map((p) => p.email));

  return (
    <div class="flex flex-col gap-3 text-xs">
      <For each={groups()}>{(group) => <CompanyCard group={group} />}</For>
      <RecentThreads addresses={addresses()} />
    </div>
  );
}

/** A muted, uppercase divider label between the panel's blocks. */
function BlockLabel(props: { children: JSX.Element }) {
  return (
    <div class="px-0.5 text-[0.625rem] font-medium uppercase tracking-wider text-ink-extra-muted">
      {props.children}
    </div>
  );
}

/**
 * A two-line row: leading icon, primary/secondary text, and — when the row
 * opens something — an affordance arrow that fades in on hover.
 *
 * Rows are plain divs rather than buttons so the card's dividers stay flush
 * and the same markup serves both the interactive and inert states.
 */
function CorrespondenceRow(props: {
  icon: JSX.Element;
  primary: JSX.Element;
  secondary?: JSX.Element;
  onOpen?: () => void;
}) {
  const navHandlers = useSplitNavigationHandler<HTMLDivElement>(() =>
    props.onOpen?.()
  );
  const isInteractive = () => !!props.onOpen;

  return (
    <div
      role={isInteractive() ? 'button' : undefined}
      tabIndex={isInteractive() ? 0 : undefined}
      class="group/row flex min-w-0 items-center gap-2 px-2.5 py-2"
      classList={{
        'cursor-pointer hover:bg-ink-muted/6': isInteractive(),
      }}
      onMouseDown={navHandlers.onMouseDown}
      onClick={(event) => {
        if (isInteractive()) navHandlers.onClick(event);
      }}
      onKeyDown={(event) => {
        if (!isInteractive()) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          props.onOpen?.();
        }
      }}
    >
      <div class="shrink-0">{props.icon}</div>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="ph-no-capture truncate leading-4 text-ink">
          {props.primary}
        </span>
        <Show when={props.secondary}>
          <span class="ph-no-capture truncate text-[0.6875rem] leading-4 text-ink-extra-muted">
            {props.secondary}
          </span>
        </Show>
      </div>
      <Show when={isInteractive()}>
        <ArrowUpRightIcon class="size-3 shrink-0 text-ink-extra-muted opacity-0 transition-opacity group-hover/row:opacity-100" />
      </Show>
    </div>
  );
}

/**
 * One external domain: the CRM company that owns it (when the team tracks
 * one) followed by the people from that domain on this thread or event.
 *
 * The company lookup carries the contacts, so a card resolves both its header
 * and every contact link from a single pair of requests.
 */
function CompanyCard(props: { group: CorrespondencePartyGroup }) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const { company, contacts, isLoading } = useCrmCompanyForDomain(
    () => props.group.domain
  );

  const contactByAddress = createMemo(() => {
    const byAddress = new Map<string, CompanyContact>();
    for (const contact of contacts()) {
      byAddress.set(contact.email.trim().toLowerCase(), contact);
    }
    return byAddress;
  });

  return (
    <SidePanel.Card>
      <Show
        when={company()}
        fallback={
          <Show
            when={!isLoading()}
            fallback={
              <div class="px-2.5 py-2">
                <SidePanel.Loading />
              </div>
            }
          >
            <CorrespondenceRow
              icon={
                <EntityIcon
                  targetType="crm_company"
                  size="sm"
                  theme="monochrome"
                  class="text-ink-extra-muted"
                />
              }
              primary={<span class="text-ink-muted">{props.group.domain}</span>}
            />
          </Show>
        }
      >
        {(record) => (
          <CorrespondenceRow
            icon={<EntityIcon targetType="crm_company" size="sm" />}
            primary={
              <span class="font-medium">
                {record().name || props.group.domain}
              </span>
            }
            secondary={
              record().name && record().name !== props.group.domain
                ? props.group.domain
                : undefined
            }
            onOpen={() =>
              replaceOrInsertSplit({ type: 'company', id: record().id })
            }
          />
        )}
      </Show>

      <For each={props.group.parties}>
        {(party) => (
          <ContactRow
            party={party}
            contact={contactByAddress().get(party.email)}
          />
        )}
      </For>
    </SidePanel.Card>
  );
}

/**
 * One external party. Opens their CRM contact record when the team tracks
 * one; otherwise it is a plain, inert row showing what the thread/event knows
 * about them.
 */
function ContactRow(props: {
  party: CorrespondenceParty;
  contact?: CompanyContact;
}) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const label = () =>
    props.contact?.name ?? props.party.name ?? props.party.email;

  return (
    <CorrespondenceRow
      icon={<UserIcon email={props.party.email} size="sm" suppressClick />}
      primary={label()}
      secondary={label() === props.party.email ? undefined : props.party.email}
      onOpen={
        props.contact
          ? () =>
              replaceOrInsertSplit({
                type: 'contact',
                id: props.contact?.id ?? '',
              })
          : undefined
      }
    />
  );
}

/**
 * The most recent shared email threads, capped at
 * {@link CORRESPONDENCE_THREAD_LIMIT} and scrolled inside a fixed-height box
 * so a chatty correspondent can't stretch the panel.
 */
function RecentThreads(props: { addresses: string[] }) {
  const threadsQuery = useCorrespondenceThreadsQuery(() => props.addresses);
  const threads = createMemo(() =>
    (threadsQuery.data?.entities ?? []).slice(0, CORRESPONDENCE_THREAD_LIMIT)
  );

  const [listRef, setListRef] = createSignal<HTMLElement>();

  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <BlockLabel>Recent emails</BlockLabel>
      <Suspense fallback={<SidePanel.Loading />}>
        <Show when={!threadsQuery.isLoading} fallback={<SidePanel.Loading />}>
          <Show
            when={threads().length > 0}
            fallback={
              <div class="rounded-lg border border-dashed border-edge-muted px-3 py-4 text-center text-ink-muted">
                No emails with these contacts yet.
              </div>
            }
          >
            <SidePanel.Card>
              <div class="max-h-64 overflow-y-auto">
                <ListEntityMetadataQueryProvider>
                  <ListLayoutProvider ref={listRef}>
                    <div ref={setListRef} class="flex flex-col">
                      <For each={threads()}>
                        {(entity) => (
                          <ListEntity
                            entity={entity}
                            timestamp={entity.updatedAt}
                            onClick={() =>
                              openEntityInSplitFromUnifiedList(entity, {})
                            }
                          />
                        )}
                      </For>
                    </div>
                  </ListLayoutProvider>
                </ListEntityMetadataQueryProvider>
              </div>
            </SidePanel.Card>
          </Show>
        </Show>
      </Suspense>
    </div>
  );
}
