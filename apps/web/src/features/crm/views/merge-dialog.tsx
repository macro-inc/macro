import { formatLocale, t } from '@app/lib/i18n';
import { EntityIcon } from '@core/component/EntityIcon';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import GlobeIcon from '@icon/system/regular/globe.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Input,
  RadioGroup,
  Spinner,
} from '@ui';
import { ActionDialogShell } from '@ui/components/ActionDialogShell';
import {
  type Accessor,
  type Component,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import { useCrmContext } from '../context/crm-context';
import {
  MAX_MERGE_SOURCES,
  type MergeBlock,
  type MergeCandidate,
  type MergeOtherCompanyPerson,
  type MergeRecord,
  type MergeRecordType,
  type MergeRefusal,
  type MergeReview,
  type MergeSameAddressPerson,
  type MergeSharingChoice,
} from '../core/merge';

export type MergeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordType: MergeRecordType;
  /** The records the merge starts with; one means "merge with…". */
  records: MergeCandidate[];
  onMerged: (merge: { survivor: MergeRecord; merged: MergeRecord[] }) => void;
};

type Step = 'pick' | 'keep' | 'review';

type ReviewState =
  | { t: 'loading' }
  | {
      t: 'ready';
      review: MergeReview;
      survivor: MergeRecord;
      sources: MergeRecord[];
      /** One per review: a retry of its commit sends it again. */
      requestKey: string;
    }
  | { t: 'refused'; refusal: MergeRefusal };

/** The words and marks that differ between merging companies and people. */
type MergeCopy = {
  entityType: 'crm_company' | 'crm_contact';
  IdentifierIcon: Component<{ class?: string }>;
  pickTitle: () => string;
  pickDescription: (name: string) => string;
  searchLabel: () => string;
  searchPlaceholder: () => string;
  noMatches: () => string;
  tooMany: (count: number) => string;
  keepTitle: () => string;
  keepDescription: () => string;
  keepLabel: () => string;
  reviewDescription: (count: number, names: string, name: string) => string;
  identifiers: () => string;
  movesNothing: () => string;
  sharingDescription: (count: number) => string;
  confirm: (count: number) => string;
  blockedTitle: () => string;
  refusePermission: () => string;
  refuseUnavailable: () => string;
  refuseMissing: () => string;
  refuseArchived: () => string;
  refuseMerged: () => string;
  refuseGeneric: () => string;
};

const COPY: Record<MergeRecordType, MergeCopy> = {
  company: {
    entityType: 'crm_company',
    IdentifierIcon: GlobeIcon,
    pickTitle: () => t('crm.mergePickTitle'),
    pickDescription: (name) => t('crm.mergePickDescription', { name }),
    searchLabel: () => t('crm.mergeSearchLabel'),
    searchPlaceholder: () => t('crm.mergeSearchPlaceholder'),
    noMatches: () => t('crm.mergeNoMatches'),
    tooMany: (count) => t('crm.mergeTooMany', { count }),
    keepTitle: () => t('crm.mergeKeepTitle'),
    keepDescription: () => t('crm.mergeKeepDescription'),
    keepLabel: () => t('crm.mergeKeepLabel'),
    reviewDescription: (count, names, name) =>
      t('crm.mergeReviewDescription', { count, names, name }),
    identifiers: () => t('crm.mergeDomains'),
    movesNothing: () => t('crm.mergeMovesNothing'),
    sharingDescription: (count) => t('crm.mergeSharingDescription', { count }),
    confirm: (count) => t('crm.mergeConfirm', { count }),
    blockedTitle: () => t('crm.mergeBlockedTitle'),
    refusePermission: () => t('crm.mergeRefusePermission'),
    refuseUnavailable: () => t('crm.mergeRefuseUnavailable'),
    refuseMissing: () => t('crm.mergeRefuseMissing'),
    refuseArchived: () => t('crm.mergeRefuseArchived'),
    refuseMerged: () => t('crm.mergeRefuseMerged'),
    refuseGeneric: () => t('crm.mergeRefuseGeneric'),
  },
  contact: {
    entityType: 'crm_contact',
    IdentifierIcon: EnvelopeIcon,
    pickTitle: () => t('crm.mergePeoplePickTitle'),
    pickDescription: (name) => t('crm.mergePeoplePickDescription', { name }),
    searchLabel: () => t('crm.mergePeopleSearchLabel'),
    searchPlaceholder: () => t('crm.mergePeopleSearchPlaceholder'),
    noMatches: () => t('crm.mergePeopleNoMatches'),
    tooMany: (count) => t('crm.mergePeopleTooMany', { count }),
    keepTitle: () => t('crm.mergePeopleKeepTitle'),
    keepDescription: () => t('crm.mergePeopleKeepDescription'),
    keepLabel: () => t('crm.mergePeopleKeepLabel'),
    reviewDescription: (count, names, name) =>
      t('crm.mergePeopleReviewDescription', { count, names, name }),
    identifiers: () => t('crm.mergeAddresses'),
    movesNothing: () => t('crm.mergePeopleMovesNothing'),
    sharingDescription: (count) =>
      t('crm.mergePeopleSharingDescription', { count }),
    confirm: (count) => t('crm.mergePeopleConfirm', { count }),
    blockedTitle: () => t('crm.mergePeopleBlockedTitle'),
    refusePermission: () => t('crm.mergePeopleRefusePermission'),
    refuseUnavailable: () => t('crm.mergePeopleRefuseUnavailable'),
    refuseMissing: () => t('crm.mergePeopleRefuseMissing'),
    refuseArchived: () => t('crm.mergePeopleRefuseArchived'),
    refuseMerged: () => t('crm.mergePeopleRefuseMerged'),
    refuseGeneric: () => t('crm.mergePeopleRefuseGeneric'),
  },
};

function joinNames(names: string[]): string {
  return new Intl.ListFormat(formatLocale(), {
    style: 'long',
    type: 'conjunction',
  }).format(names);
}

function refusalText(refusal: MergeRefusal, copy: MergeCopy): string {
  return match(refusal.code)
    .with('merge_permission_required', () => copy.refusePermission())
    .with('merge_unavailable', () => copy.refuseUnavailable())
    .with('record_unavailable', () => copy.refuseMissing())
    .with('record_hidden', () => copy.refuseArchived())
    .with('record_already_merged', () => copy.refuseMerged())
    .with('merge_sharing_rules_too_large', () => t('crm.mergeRefuseTooLarge'))
    .otherwise(() => copy.refuseGeneric());
}

/**
 * Merging duplicate companies or people into the one that stays: pick the
 * others when the merge starts from one, choose the one to keep, then confirm
 * the server's review. A review that went stale is fetched again.
 */
export function MergeDialog(props: MergeDialogProps) {
  const context = useCrmContext();
  const commands = context.createMergeCommands(props.recordType);
  const valueLabel = context.createPropertyValueLabel();
  const copy = COPY[props.recordType];
  const startsFromOne = props.records.length < 2;
  const [step, setStep] = createSignal<Step>(startsFromOne ? 'pick' : 'keep');
  const [picked, setPicked] = createSignal<MergeCandidate[]>(props.records);
  const [keepId, setKeepId] = createSignal<string>();
  const [review, setReview] = createSignal<ReviewState>({ t: 'loading' });
  const [sharing, setSharing] = createSignal<MergeSharingChoice>('keep');
  // The choice an unconfirmed commit sent: a retry under its request key has
  // to send the same command, so the choice stays until a new review.
  const [attempted, setAttempted] = createSignal<MergeSharingChoice>();
  const [notice, setNotice] = createSignal<string>();
  const [pending, setPending] = createSignal(false);
  let reviewGeneration = 0;

  const survivor = () => picked().find((record) => record.id === keepId());
  const sources = () => picked().filter((record) => record.id !== keepId());
  const tooMany = () => picked().length > MAX_MERGE_SOURCES + 1;

  const load = async () => {
    const kept = survivor();
    if (!kept) return;
    const merged = sources();
    // Only the latest review counts: an earlier one may answer last.
    const generation = ++reviewGeneration;
    setReview({ t: 'loading' });
    const answer = await commands.review({
      survivorId: kept.id,
      sourceIds: merged.map((source) => source.id),
    });
    if (generation !== reviewGeneration) return;
    if (!answer.ok) return setReview({ t: 'refused', refusal: answer.refusal });
    setAttempted(undefined);
    if (answer.value.sharingRules && !answer.value.sharingRules.keepFits)
      setSharing('stop');
    setReview({
      t: 'ready',
      review: answer.value,
      survivor: kept,
      sources: merged,
      requestKey: crypto.randomUUID(),
    });
  };

  const openReview = () => {
    setNotice(undefined);
    setStep('review');
    fireAndForget(load(), 'crm');
  };

  const merge = async () => {
    const current = review();
    if (current.t !== 'ready' || pending()) return;
    setPending(true);
    setNotice(undefined);
    const sharingRules = attempted() ?? sharing();
    const answer = await commands.commit({
      survivorId: current.survivor.id,
      sourceIds: current.sources.map((source) => source.id),
      revision: current.review.revision,
      requestKey: current.requestKey,
      sharingRules,
    });
    setPending(false);
    if (answer.ok) {
      props.onOpenChange(false);
      props.onMerged({ survivor: current.survivor, merged: current.sources });
      return;
    }
    if (answer.refusal.code === 'merge_preview_stale') {
      setNotice(t('crm.mergeStale'));
      await load();
      return;
    }
    // The merge may have gone through: merging again sends the same key,
    // which answers with the first result instead of merging twice.
    if (answer.refusal.code === 'merge_unconfirmed') {
      setAttempted(sharingRules);
      setNotice(t('crm.mergeUnconfirmed'));
      return;
    }
    setReview({ t: 'refused', refusal: answer.refusal });
  };

  const close = () => !pending() && props.onOpenChange(false);
  const size = () => (isMobile() ? 'xl' : 'md');
  const ready = () => {
    const current = review();
    return current.t === 'ready' && !current.review.blocked
      ? current.review
      : undefined;
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && close()}
      position="center"
      visibleScrim
      class="w-140"
    >
      <ActionDialogShell class="max-h-[80dvh]">
        <ActionDialogShell.Body class="space-y-4">
          <Switch>
            <Match when={step() === 'pick'}>
              <PickStep
                recordType={props.recordType}
                copy={copy}
                start={props.records[0]}
                picked={picked()}
                onToggle={(record, on) =>
                  setPicked((current) =>
                    on
                      ? [...current, record]
                      : current.filter((other) => other.id !== record.id)
                  )
                }
                tooMany={tooMany()}
              />
            </Match>
            <Match when={step() === 'keep'}>
              <ActionDialogShell.Header>
                <ActionDialogShell.Title>
                  {copy.keepTitle()}
                </ActionDialogShell.Title>
                <ActionDialogShell.Description>
                  {copy.keepDescription()}
                </ActionDialogShell.Description>
              </ActionDialogShell.Header>
              <RadioGroup
                variant="cards"
                size="md"
                aria-label={copy.keepLabel()}
                class="grid grid-cols-1 gap-2"
                value={keepId()}
                onChange={setKeepId}
              >
                <For each={picked()}>
                  {(record) => (
                    <RadioGroup.Item value={record.id}>
                      <RadioGroup.ItemControl class="mt-0.5" />
                      <RadioGroup.ItemLabel class="min-w-0 flex-1">
                        <CandidateLine
                          recordType={props.recordType}
                          candidate={record}
                        />
                      </RadioGroup.ItemLabel>
                    </RadioGroup.Item>
                  )}
                </For>
              </RadioGroup>
            </Match>
            <Match when={step() === 'review'}>
              <ActionDialogShell.Header>
                <ActionDialogShell.Title>
                  {t('crm.mergeReviewTitle', { name: survivor()?.name ?? '' })}
                </ActionDialogShell.Title>
                <Show when={ready()}>
                  <ActionDialogShell.Description>
                    {copy.reviewDescription(
                      sources().length,
                      joinNames(sources().map((source) => source.name)),
                      survivor()?.name ?? ''
                    )}
                  </ActionDialogShell.Description>
                </Show>
              </ActionDialogShell.Header>
              <Show when={notice()}>
                {(text) => (
                  <p class="text-sm text-ink-muted" role="status">
                    {text()}
                  </p>
                )}
              </Show>
              <Switch>
                <Match when={review().t === 'loading'}>
                  <div class="flex h-40 items-center justify-center">
                    <Spinner size="md" />
                  </div>
                </Match>
                <Match
                  when={(() => {
                    const current = review();
                    return current.t === 'refused'
                      ? current.refusal
                      : undefined;
                  })()}
                >
                  {(refusal) => (
                    <Show
                      when={refusal().blocked}
                      fallback={
                        <Refusal title={refusalText(refusal(), copy)}>
                          <p>{t('crm.mergeNothingChanged')}</p>
                        </Refusal>
                      }
                    >
                      {(block) => (
                        <Blocked
                          block={block()}
                          copy={copy}
                          records={picked()}
                        />
                      )}
                    </Show>
                  )}
                </Match>
                <Match
                  when={(() => {
                    const current = review();
                    return current.t === 'ready' && current.review.blocked
                      ? current.review.blocked
                      : undefined;
                  })()}
                >
                  {(block) => (
                    <Blocked block={block()} copy={copy} records={picked()} />
                  )}
                </Match>
                <Match when={ready()}>
                  {(current) => (
                    <ReviewBody
                      recordType={props.recordType}
                      copy={copy}
                      review={current()}
                      survivor={survivor()?.name ?? ''}
                      sharing={attempted() ?? sharing()}
                      sharingLocked={attempted() !== undefined}
                      onSharing={setSharing}
                      valueLabel={valueLabel}
                    />
                  )}
                </Match>
              </Switch>
            </Match>
          </Switch>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer>
          <Switch>
            <Match when={step() === 'pick'}>
              <Button variant="ghost" size={size()} onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                size={size()}
                disabled={picked().length < 2 || tooMany()}
                onClick={() => setStep('keep')}
              >
                {t('crm.mergeContinue')}
              </Button>
            </Match>
            <Match when={step() === 'keep'}>
              <Button
                variant="ghost"
                size={size()}
                onClick={() => (startsFromOne ? setStep('pick') : close())}
              >
                {startsFromOne ? t('common.back') : t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                size={size()}
                disabled={!survivor() || tooMany()}
                onClick={openReview}
              >
                {t('crm.mergeReviewAction')}
              </Button>
            </Match>
            <Match when={step() === 'review'}>
              <Button
                variant="ghost"
                size={size()}
                disabled={pending()}
                onClick={() => setStep('keep')}
              >
                {t('common.back')}
              </Button>
              <Show
                when={ready() || review().t === 'loading'}
                fallback={
                  <Button variant="primary" size={size()} onClick={close}>
                    {t('common.close')}
                  </Button>
                }
              >
                <Button
                  variant="danger"
                  size={size()}
                  disabled={!ready() || pending()}
                  onClick={() => fireAndForget(merge(), 'crm')}
                >
                  <Show when={pending()}>
                    <Spinner size="sm" decorative />
                  </Show>
                  {pending()
                    ? t('crm.mergeMerging')
                    : copy.confirm(picked().length)}
                </Button>
              </Show>
            </Match>
          </Switch>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}

function CandidateLine(props: {
  recordType: MergeRecordType;
  candidate: MergeCandidate;
}) {
  // A record without a name is listed by its address or domain; don't say it
  // twice.
  const detail = () =>
    [
      props.candidate.identifiers
        .filter((identifier) => identifier !== props.candidate.name)
        .join(', '),
      props.candidate.company,
    ]
      .filter((part) => !!part)
      .join(' · ');
  return (
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
        <EntityIcon
          targetType={COPY[props.recordType].entityType}
          size="xs"
          class="shrink-0"
        />
        <span class="min-w-0 truncate">{props.candidate.name}</span>
      </span>
      <Show when={detail()}>
        <span class="truncate text-xs text-ink-muted">{detail()}</span>
      </Show>
    </span>
  );
}

type PickSource = {
  /** The records that match `search`; the most recent ones while it's empty. */
  matches: Accessor<MergeCandidate[]>;
  loading: () => boolean;
  hasMore: () => boolean;
  loadingMore: () => boolean;
  loadMore: () => Promise<void>;
  /** A failed search, so an empty list isn't read as no one matching. */
  failed: () => boolean;
  retry: () => Promise<void>;
};

/** The first records Quick Access holds that match `search`, by any name, address or company. */
function quickAccessMatches(
  records: MergeCandidate[],
  search: string
): MergeCandidate[] {
  const query = search.trim().toLowerCase();
  const found = (text: string | null | undefined) =>
    !!text && text.toLowerCase().includes(query);
  return records
    .filter(
      (record) =>
        query === '' ||
        found(record.name) ||
        found(record.company) ||
        record.identifiers.some(found)
    )
    .slice(0, 50);
}

/**
 * The records a merge can pick from. Companies come from Quick Access. People
 * do too, and while a search is typed, the server's matches beyond it follow:
 * a team can hold far more people than Quick Access keeps.
 */
type PickRecord = { id: string; teamId?: string | null };

/**
 * Quick Access matches, then the server's beyond them while a search is
 * typed, each listed once. A merge stays within one team, so the viewer's
 * other teams' records are left out.
 */
function combinedSource<T extends PickRecord>(options: {
  search: Accessor<string>;
  teamId: () => string | undefined;
  teamPending: () => boolean;
  suggestions: () => readonly T[];
  suggestionsLoading: () => boolean;
  server: {
    results: () => readonly T[];
    isLoading: () => boolean;
    hasMore: () => boolean;
    isLoadingMore: () => boolean;
    loadMore: () => Promise<void>;
    error: () => unknown;
    retry: () => Promise<void>;
  };
  candidate: (record: T) => MergeCandidate;
}): PickSource {
  const searching = () => options.search().trim() !== '';
  const ours = (record: T) =>
    options.teamId() !== undefined && record.teamId === options.teamId();
  return {
    matches: () => {
      const local = quickAccessMatches(
        options.suggestions().filter(ours).map(options.candidate),
        options.search()
      );
      if (!searching()) return local;
      const seen = new Set(local.map((record) => record.id));
      return [
        ...local,
        ...options.server
          .results()
          .filter((record) => ours(record) && !seen.has(record.id))
          .map(options.candidate),
      ];
    },
    loading: () =>
      options.teamPending() ||
      options.suggestionsLoading() ||
      (searching() && options.server.isLoading()),
    hasMore: () => searching() && options.server.hasMore(),
    loadingMore: () => options.server.isLoadingMore(),
    loadMore: options.server.loadMore,
    failed: () => searching() && options.server.error() !== undefined,
    retry: options.server.retry,
  };
}

/**
 * The records a merge can pick from: the current team's, from Quick Access
 * and, while a search is typed, the server's matches beyond it, since a team
 * can hold far more records than Quick Access keeps.
 */
function usePickSource(
  recordType: MergeRecordType,
  search: Accessor<string>
): PickSource {
  const context = useCrmContext();
  const team = context.createTeamSource();
  const teamId = () => team.data?.team.id;
  const teamPending = () => team.isPending;
  return match(recordType)
    .with('company', (): PickSource => {
      const suggestions = context.createCompanySuggestions();
      const server = context.createCompanySearch(search);
      return combinedSource({
        search,
        teamId,
        teamPending,
        suggestions: suggestions.companies,
        suggestionsLoading: () => suggestions.query.isLoading,
        server: { ...server, results: server.companies },
        candidate: (company) => ({
          id: company.id,
          name: company.name,
          identifiers: company.domains.map((domain) => domain.domain),
        }),
      });
    })
    .with('contact', (): PickSource => {
      const suggestions = context.createContactSuggestions();
      const server = context.createContactSearch(search);
      return combinedSource({
        search,
        teamId,
        teamPending,
        suggestions: suggestions.contacts,
        suggestionsLoading: () => suggestions.query.isLoading,
        server: { ...server, results: server.contacts },
        candidate: (contact) => ({
          id: contact.id,
          name: contact.name,
          identifiers: contact.email ? [contact.email] : [],
          company: contact.companyName ?? null,
        }),
      });
    })
    .exhaustive();
}

function PickStep(props: {
  recordType: MergeRecordType;
  copy: MergeCopy;
  start: MergeCandidate | undefined;
  picked: MergeCandidate[];
  onToggle: (record: MergeCandidate, on: boolean) => void;
  tooMany: boolean;
}) {
  const [search, setSearch] = createSignal('');
  const source = usePickSource(props.recordType, search);
  const matches = createMemo(() =>
    source.matches().filter((record) => record.id !== props.start?.id)
  );
  return (
    <>
      <ActionDialogShell.Header>
        <ActionDialogShell.Title>
          {props.copy.pickTitle()}
        </ActionDialogShell.Title>
        <ActionDialogShell.Description>
          {props.copy.pickDescription(props.start?.name ?? '')}
        </ActionDialogShell.Description>
      </ActionDialogShell.Header>
      <Input
        aria-label={props.copy.searchLabel()}
        placeholder={props.copy.searchPlaceholder()}
        value={search()}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <Show when={props.tooMany}>
        <p class="text-sm text-failure" role="status">
          {props.copy.tooMany(MAX_MERGE_SOURCES + 1)}
        </p>
      </Show>
      <Show
        when={matches().length > 0 || source.loading() || source.failed()}
        fallback={
          <p class="text-sm text-ink-muted">{props.copy.noMatches()}</p>
        }
      >
        <div class="flex flex-col gap-1">
          <For each={matches()}>
            {(record) => (
              <Checkbox
                class="flex min-h-11 items-center gap-3 rounded-lg px-2"
                checked={props.picked.some(
                  (current) => current.id === record.id
                )}
                onChange={(checked) => props.onToggle(record, checked)}
              >
                <Checkbox.Control />
                <Checkbox.Label class="min-w-0 flex-1">
                  <CandidateLine
                    recordType={props.recordType}
                    candidate={record}
                  />
                </Checkbox.Label>
              </Checkbox>
            )}
          </For>
        </div>
      </Show>
      <Show when={source.failed()}>
        <div
          class="flex items-center gap-2 text-sm text-ink-muted"
          role="alert"
        >
          <span>{t('crm.mergeSearchFailed')}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fireAndForget(source.retry(), 'crm')}
          >
            {t('common.retry')}
          </Button>
        </div>
      </Show>
      <Show when={source.hasMore() && !source.failed()}>
        <Button
          variant="ghost"
          size="sm"
          disabled={source.loadingMore()}
          onClick={() => fireAndForget(source.loadMore(), 'crm')}
        >
          {t('common.showMore')}
        </Button>
      </Show>
    </>
  );
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="space-y-1.5">
      <h3 class="text-xs font-medium text-ink-muted">{props.title}</h3>
      {props.children}
    </section>
  );
}

function ReviewBody(props: {
  recordType: MergeRecordType;
  copy: MergeCopy;
  review: MergeReview;
  survivor: string;
  sharing: MergeSharingChoice;
  sharingLocked: boolean;
  onSharing: (choice: MergeSharingChoice) => void;
  valueLabel: (propertyId: string, value: unknown) => string | undefined;
}) {
  const sourceName = (id: string) =>
    props.review.sources.find((source) => source.id === id)?.name ?? '';
  const moves = () => {
    const { moves } = props.review;
    return [
      moves.contacts > 0 && t('crm.mergeMovePeople', { count: moves.contacts }),
      moves.pipelineEntries > 0 &&
        t('crm.mergeMoveEntries', { count: moves.pipelineEntries }),
      moves.references > 0 &&
        t('crm.mergeMoveLinks', { count: moves.references }),
      moves.discussionMessages > 0 &&
        t('crm.mergeMoveMessages', { count: moves.discussionMessages }),
    ].filter((line): line is string => typeof line === 'string');
  };
  const label = (propertyId: string, value: unknown) =>
    props.valueLabel(propertyId, value) ?? t('crm.mergeConflictValue');
  return (
    <div class="space-y-4">
      <Section title={props.copy.identifiers()}>
        <div class="flex flex-wrap gap-1.5">
          <For each={props.review.identifiers}>
            {(identifier, index) => (
              <Badge variant="secondary" size="sm">
                <props.copy.IdentifierIcon class="size-3" />
                {identifier}
                <Show when={index() === 0}>
                  <span class="font-normal text-ink-muted">
                    {t('crm.mergePrimary')}
                  </span>
                </Show>
              </Badge>
            )}
          </For>
        </div>
      </Section>
      <Section title={t('crm.mergeMovesTo', { name: props.survivor })}>
        <Show
          when={moves().length > 0}
          fallback={
            <p class="text-sm text-ink-muted">{props.copy.movesNothing()}</p>
          }
        >
          <ul class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-ink touch:grid-cols-1">
            <For each={moves()}>{(line) => <li>{line}</li>}</For>
          </ul>
        </Show>
      </Section>
      <Show when={props.review.sharedPipelines.length > 0}>
        <Section title={t('crm.mergePipelines')}>
          <ul class="space-y-1 text-sm text-ink">
            <For each={props.review.sharedPipelines}>
              {(pipeline) => (
                <li>
                  {t('crm.mergeSharedPipeline', {
                    pipeline: pipeline.name,
                    count: pipeline.entriesAfter,
                  })}
                </li>
              )}
            </For>
          </ul>
        </Section>
      </Show>
      <Show when={props.review.conflicts.length > 0}>
        <Section title={t('crm.mergeConflicts')}>
          <div
            class="max-h-64 divide-y divide-edge-divider overflow-y-auto rounded-lg border border-edge-divider text-sm"
            data-merge-conflicts
          >
            <div class="grid grid-cols-[6rem_1fr_1fr] gap-3 px-3 py-1.5 text-xs text-ink-muted">
              <span />
              <span>{t('crm.mergeConflictKept')}</span>
              <span>{t('crm.mergeConflictDropped')}</span>
            </div>
            <For each={props.review.conflicts}>
              {(conflict) => (
                <div class="grid grid-cols-[6rem_1fr_1fr] gap-3 px-3 py-2">
                  <span class="min-w-0 truncate text-ink-muted">
                    {conflict.propertyName}
                  </span>
                  <span class="min-w-0 text-ink">
                    {label(conflict.propertyId, conflict.kept)}
                  </span>
                  <span class="min-w-0 text-ink-muted">
                    <For each={conflict.dropped}>
                      {(dropped) => (
                        <span class="block">
                          <s>{label(conflict.propertyId, dropped.value)}</s>{' '}
                          <span class="text-xs text-ink-extra-muted touch:block">
                            {sourceName(dropped.recordId)}
                          </span>
                        </span>
                      )}
                    </For>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Section>
      </Show>
      <Section title={t('crm.mergeEmailSync')}>
        <ul class="space-y-1 text-sm text-ink">
          <li>
            {props.review.emailSync.survivorSyncs
              ? t('crm.mergeSyncOn', { name: props.survivor })
              : t('crm.mergeSyncOff', { name: props.survivor })}
          </li>
          <Show when={props.review.emailSync.keptOut.length > 0}>
            <li>
              {t('crm.mergeSyncKeptOut', {
                domains: joinNames(props.review.emailSync.keptOut),
              })}
            </li>
          </Show>
        </ul>
      </Section>
      <Show when={props.review.sharingRules}>
        {(rules) => (
          <Section title={t('crm.mergeSharing')}>
            <p class="text-sm text-ink">
              {props.copy.sharingDescription(rules().teammates)}
            </p>
            <RadioGroup
              size="md"
              aria-label={t('crm.mergeSharingLabel')}
              class="grid gap-1.5"
              value={props.sharing}
              disabled={props.sharingLocked}
              onChange={(value) => props.onSharing(value as MergeSharingChoice)}
            >
              <RadioGroup.Item value="keep" disabled={!rules().keepFits}>
                <RadioGroup.ItemControl />
                <RadioGroup.ItemLabel>
                  {t('crm.mergeSharingKeep')}
                </RadioGroup.ItemLabel>
              </RadioGroup.Item>
              <Show when={!rules().keepFits}>
                <p class="pl-6 text-xs text-ink-muted">
                  {t('crm.mergeSharingTooLarge')}
                </p>
              </Show>
              <RadioGroup.Item value="stop">
                <RadioGroup.ItemControl />
                <RadioGroup.ItemLabel>
                  {t('crm.mergeSharingStop')}
                </RadioGroup.ItemLabel>
              </RadioGroup.Item>
            </RadioGroup>
          </Section>
        )}
      </Show>
      <p class="flex items-center gap-1.5 text-sm text-failure">
        <WarningIcon class="size-4 shrink-0" />
        {t('crm.mergeUndoWarning')}
      </p>
    </div>
  );
}

function Blocked(props: {
  block: MergeBlock;
  copy: MergeCopy;
  records: MergeCandidate[];
}) {
  const nameOf = (id: string) =>
    props.records.find((record) => record.id === id)?.name ?? '';
  const sameAddress = () =>
    props.block.kind === 'same_address_people' ? props.block.people : undefined;
  const otherCompanies = () =>
    props.block.kind === 'different_companies' ? props.block.people : undefined;
  return (
    <Switch
      fallback={
        <Refusal title={props.copy.blockedTitle()}>
          <p>{t('crm.mergeNothingChanged')}</p>
        </Refusal>
      }
    >
      <Match when={sameAddress()}>
        {(people) => <SameAddress people={people()} company={nameOf} />}
      </Match>
      <Match when={otherCompanies()}>
        {(people) => <OtherCompanies people={people()} name={nameOf} />}
      </Match>
    </Switch>
  );
}

function SameAddress(props: {
  people: MergeSameAddressPerson[];
  company: (id: string) => string;
}) {
  return (
    <Refusal title={t('crm.mergeSameAddressTitle')}>
      <p>{t('crm.mergeSameAddressBody')}</p>
      <ul class="space-y-1">
        <For each={props.people}>
          {(person) => (
            <li>
              {t('crm.mergeSameAddressPerson', {
                name: person.name || person.address,
                address: person.address,
                company: props.company(person.recordId),
              })}
              <Show when={person.archived}>
                {' '}
                <Badge variant="secondary" size="sm">
                  {t('crm.mergeArchived')}
                </Badge>
              </Show>
            </li>
          )}
        </For>
      </ul>
      <p>{t('crm.mergeNothingChanged')}</p>
    </Refusal>
  );
}

function OtherCompanies(props: {
  people: MergeOtherCompanyPerson[];
  name: (id: string) => string;
}) {
  return (
    <Refusal title={t('crm.mergeDifferentCompaniesTitle')}>
      <p>{t('crm.mergeDifferentCompaniesBody')}</p>
      <ul class="space-y-1">
        <For each={props.people}>
          {(person) => (
            <li>
              {t('crm.mergeDifferentCompaniesPerson', {
                name: person.name || props.name(person.contactId),
                company: person.companyName,
              })}
            </li>
          )}
        </For>
      </ul>
      <p>{t('crm.mergeNothingChanged')}</p>
    </Refusal>
  );
}

function Refusal(props: { title: string; children: JSX.Element }) {
  return (
    <div
      role="alert"
      class="flex gap-3 rounded-lg border border-edge-divider p-3"
    >
      <WarningIcon class="mt-0.5 size-4 shrink-0 text-failure" />
      <div class="min-w-0 space-y-2 text-sm text-ink-muted">
        <p class="font-medium text-ink">{props.title}</p>
        {props.children}
      </div>
    </div>
  );
}
