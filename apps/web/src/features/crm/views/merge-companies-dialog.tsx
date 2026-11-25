import { formatLocale, t } from '@app/lib/i18n';
import { EntityIcon } from '@core/component/EntityIcon';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
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
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { useCrmContext } from '../context/crm-context';
import {
  MAX_MERGE_SOURCES,
  type MergeBlock,
  type MergeCompany,
  type MergeRefusal,
  type MergeReview,
  type MergeSharingChoice,
} from '../core/merge';
import { useQuickAccessCrmCompaniesQuery } from './use-crm';

/** A company offered for a merge, with the domains that tell it apart. */
export type MergeCandidate = MergeCompany & { domains: string[] };

export type MergeCompaniesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The companies the merge starts with; one means "merge with…". */
  companies: MergeCandidate[];
  onMerged: (merge: { survivor: MergeCompany; merged: MergeCompany[] }) => void;
};

type Step = 'pick' | 'keep' | 'review';

type ReviewState =
  | { t: 'loading' }
  | { t: 'ready'; review: MergeReview }
  | { t: 'refused'; refusal: MergeRefusal };

function joinNames(names: string[]): string {
  return new Intl.ListFormat(formatLocale(), {
    style: 'long',
    type: 'conjunction',
  }).format(names);
}

function refusalText(refusal: MergeRefusal): string {
  switch (refusal.code) {
    case 'merge_permission_required':
      return t('crm.mergeRefusePermission');
    case 'merge_unavailable':
      return t('crm.mergeRefuseUnavailable');
    case 'record_unavailable':
      return t('crm.mergeRefuseMissing');
    case 'record_hidden':
      return t('crm.mergeRefuseArchived');
    case 'record_already_merged':
      return t('crm.mergeRefuseMerged');
    case 'merge_sharing_rules_too_large':
      return t('crm.mergeRefuseTooLarge');
    default:
      return t('crm.mergeRefuseGeneric');
  }
}

/**
 * Merging duplicate companies into the one that stays: pick the companies
 * when the merge starts from one, choose the one to keep, then confirm the
 * server's review. A review that went stale is fetched again.
 */
export function MergeCompaniesDialog(props: MergeCompaniesDialogProps) {
  const context = useCrmContext();
  const commands = context.createMergeCommands();
  const valueLabel = context.createPropertyValueLabel();
  const startsFromOne = props.companies.length < 2;
  const [step, setStep] = createSignal<Step>(startsFromOne ? 'pick' : 'keep');
  const [picked, setPicked] = createSignal<MergeCandidate[]>(props.companies);
  const [keepId, setKeepId] = createSignal<string>();
  const [review, setReview] = createSignal<ReviewState>({ t: 'loading' });
  const [sharing, setSharing] = createSignal<MergeSharingChoice>('keep');
  const [notice, setNotice] = createSignal<string>();
  const [pending, setPending] = createSignal(false);
  let requestKey = crypto.randomUUID();

  const survivor = () => picked().find((company) => company.id === keepId());
  const sources = () => picked().filter((company) => company.id !== keepId());
  const tooMany = () => picked().length > MAX_MERGE_SOURCES + 1;

  const load = async () => {
    const kept = survivor();
    if (!kept) return;
    setReview({ t: 'loading' });
    const answer = await commands.review({
      survivorId: kept.id,
      sourceIds: sources().map((source) => source.id),
    });
    if (!answer.ok) return setReview({ t: 'refused', refusal: answer.refusal });
    // A new review is a new merge to the server.
    requestKey = crypto.randomUUID();
    if (answer.value.sharingRules && !answer.value.sharingRules.keepFits)
      setSharing('stop');
    setReview({ t: 'ready', review: answer.value });
  };

  const openReview = () => {
    setNotice(undefined);
    setStep('review');
    fireAndForget(load(), 'crm');
  };

  const merge = async () => {
    const current = review();
    const kept = survivor();
    if (current.t !== 'ready' || !kept || pending()) return;
    setPending(true);
    const answer = await commands.commit({
      survivorId: kept.id,
      sourceIds: sources().map((source) => source.id),
      revision: current.review.revision,
      requestKey,
      sharingRules: sharing(),
    });
    setPending(false);
    if (answer.ok) {
      props.onOpenChange(false);
      props.onMerged({ survivor: kept, merged: sources() });
      return;
    }
    if (answer.refusal.code === 'merge_preview_stale') {
      setNotice(t('crm.mergeStale'));
      await load();
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
                start={props.companies[0]}
                picked={picked()}
                onToggle={(company, on) =>
                  setPicked((current) =>
                    on
                      ? [...current, company]
                      : current.filter((other) => other.id !== company.id)
                  )
                }
                tooMany={tooMany()}
              />
            </Match>
            <Match when={step() === 'keep'}>
              <ActionDialogShell.Header>
                <ActionDialogShell.Title>
                  {t('crm.mergeKeepTitle')}
                </ActionDialogShell.Title>
                <ActionDialogShell.Description>
                  {t('crm.mergeKeepDescription')}
                </ActionDialogShell.Description>
              </ActionDialogShell.Header>
              <RadioGroup
                variant="cards"
                size="md"
                aria-label={t('crm.mergeKeepLabel')}
                class="grid grid-cols-1 gap-2"
                value={keepId()}
                onChange={setKeepId}
              >
                <For each={picked()}>
                  {(company) => (
                    <RadioGroup.Item value={company.id}>
                      <RadioGroup.ItemControl class="mt-0.5" />
                      <RadioGroup.ItemLabel class="min-w-0 flex-1">
                        <CompanyLine company={company} />
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
                    {t('crm.mergeReviewDescription', {
                      count: sources().length,
                      names: joinNames(sources().map((source) => source.name)),
                      name: survivor()?.name ?? '',
                    })}
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
                        <Refusal title={refusalText(refusal())}>
                          <p>{t('crm.mergeNothingChanged')}</p>
                        </Refusal>
                      }
                    >
                      {(block) => (
                        <Blocked block={block()} companies={picked()} />
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
                  {(block) => <Blocked block={block()} companies={picked()} />}
                </Match>
                <Match when={ready()}>
                  {(current) => (
                    <ReviewBody
                      review={current()}
                      survivor={survivor()?.name ?? ''}
                      sharing={sharing()}
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
                    : t('crm.mergeConfirm', { count: picked().length })}
                </Button>
              </Show>
            </Match>
          </Switch>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}

function CompanyLine(props: { company: MergeCandidate }) {
  return (
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
        <EntityIcon targetType="crm_company" size="xs" class="shrink-0" />
        <span class="min-w-0 truncate">{props.company.name}</span>
      </span>
      <Show when={props.company.domains.length > 0}>
        <span class="truncate text-xs text-ink-muted">
          {props.company.domains.join(', ')}
        </span>
      </Show>
    </span>
  );
}

function PickStep(props: {
  start: MergeCandidate | undefined;
  picked: MergeCandidate[];
  onToggle: (company: MergeCandidate, on: boolean) => void;
  tooMany: boolean;
}) {
  const suggestions = useQuickAccessCrmCompaniesQuery();
  const [search, setSearch] = createSignal('');
  const matches = createMemo(() => {
    const query = search().trim().toLowerCase();
    return suggestions
      .companies()
      .filter(
        (company) =>
          company.id !== props.start?.id &&
          (query === '' ||
            company.name.toLowerCase().includes(query) ||
            company.domains.some((domain) =>
              domain.domain.toLowerCase().includes(query)
            ))
      )
      .slice(0, 50)
      .map(
        (company): MergeCandidate => ({
          id: company.id,
          name: company.name,
          domains: company.domains.map((domain) => domain.domain),
        })
      );
  });
  return (
    <>
      <ActionDialogShell.Header>
        <ActionDialogShell.Title>
          {t('crm.mergePickTitle')}
        </ActionDialogShell.Title>
        <ActionDialogShell.Description>
          {t('crm.mergePickDescription', { name: props.start?.name ?? '' })}
        </ActionDialogShell.Description>
      </ActionDialogShell.Header>
      <Input
        aria-label={t('crm.mergeSearchLabel')}
        placeholder={t('crm.mergeSearchPlaceholder')}
        value={search()}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <Show when={props.tooMany}>
        <p class="text-sm text-failure" role="status">
          {t('crm.mergeTooMany', { count: MAX_MERGE_SOURCES + 1 })}
        </p>
      </Show>
      <Show
        when={matches().length > 0 || suggestions.query.isLoading}
        fallback={
          <p class="text-sm text-ink-muted">{t('crm.mergeNoMatches')}</p>
        }
      >
        <div class="flex flex-col gap-1">
          <For each={matches()}>
            {(company) => (
              <Checkbox
                class="flex min-h-11 items-center gap-3 rounded-lg px-2"
                checked={props.picked.some(
                  (current) => current.id === company.id
                )}
                onChange={(checked) => props.onToggle(company, checked)}
              >
                <Checkbox.Control />
                <Checkbox.Label class="min-w-0 flex-1">
                  <CompanyLine company={company} />
                </Checkbox.Label>
              </Checkbox>
            )}
          </For>
        </div>
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
  review: MergeReview;
  survivor: string;
  sharing: MergeSharingChoice;
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
      <Section title={t('crm.mergeDomains')}>
        <div class="flex flex-wrap gap-1.5">
          <For each={props.review.identifiers}>
            {(domain, index) => (
              <Badge variant="secondary" size="sm">
                <GlobeIcon class="size-3" />
                {domain}
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
            <p class="text-sm text-ink-muted">{t('crm.mergeMovesNothing')}</p>
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
              {t('crm.mergeSharingDescription', { count: rules().teammates })}
            </p>
            <RadioGroup
              size="md"
              aria-label={t('crm.mergeSharingLabel')}
              class="grid gap-1.5"
              value={props.sharing}
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

function Blocked(props: { block: MergeBlock; companies: MergeCandidate[] }) {
  const company = (id: string) =>
    props.companies.find((candidate) => candidate.id === id)?.name ?? '';
  return (
    <Show
      when={props.block.kind === 'same_address_people' && props.block.people}
      fallback={
        <Refusal title={t('crm.mergeBlockedTitle')}>
          <p>{t('crm.mergeNothingChanged')}</p>
        </Refusal>
      }
    >
      {(people) => (
        <Refusal title={t('crm.mergeSameAddressTitle')}>
          <p>{t('crm.mergeSameAddressBody')}</p>
          <ul class="space-y-1">
            <For each={people()}>
              {(person) => (
                <li>
                  {t('crm.mergeSameAddressPerson', {
                    name: person.name || person.address,
                    address: person.address,
                    company: company(person.recordId),
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
      )}
    </Show>
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
