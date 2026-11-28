import { DiffCounts, StatusLetter } from '@app/components/diff-view';
import { useChanges } from '@app/features/changes/changes';
import { t } from '@app/lib/i18n';
import { useFlow } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import { GithubLabelPills } from '@entity/components/GithubLabelPill';
import {
  CheckStateIcon,
  checkDurationText,
} from '@entity/composed/list-entity/foreign';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import ArrowsClockwise from '@icon/system/regular/arrows-clockwise.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import Chat from '@icon/system/regular/chat.svg';
import GitMerge from '@icon/system/regular/git-merge.svg';
import X from '@icon/system/regular/x.svg';
import { Button, Card, cn, Dialog, ToggleSwitch } from '@ui';
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { PrPriorityIcon } from '../../component/PrLinks';
import { PrStatusIcon } from '../../component/PrStatus';
import { usePrPage } from '../../context/pr-page-context';
import type { PrPageReadModel } from '../../context/pr-page-read-model';
import { checkOutcome } from '../../data/checks';
import {
  type PrListDensity,
  prFileCommentCounts,
  prPageReadyToMerge,
  prRowHeight,
  prVisibleChecks,
} from '../../primitives/pr-page-state';
import { PrGithubAvatar } from './pr-header';

export function PrListRow(props: {
  density?: PrListDensity;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <div
      class={cn('flex min-w-0 items-center gap-2 text-sm', props.class)}
      style={{ 'min-height': `${prRowHeight(props.density ?? 'compact')}px` }}
    >
      {props.children}
    </div>
  );
}

export function PrDetailsSection(props: {
  title: string;
  count?: number | string;
  children: JSX.Element;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  sectionRef?: (element: HTMLElement) => void;
}) {
  const [localOpen, setLocalOpen] = createSignal(true);
  const open = () => props.open ?? localOpen();
  const toggle = () => {
    const next = !open();
    if (props.open === undefined) setLocalOpen(next);
    props.onOpenChange?.(next);
  };
  return (
    <section
      ref={props.sectionRef}
      class="group flex min-w-0 flex-col gap-2 py-3"
    >
      <button
        type="button"
        class="flex min-h-[30px] min-w-0 flex-1 items-center gap-2 text-left text-sm text-ink-muted touch:min-h-11"
        aria-expanded={open()}
        onClick={toggle}
      >
        <span class="flex-1">{props.title}</span>
        <span class="text-xs">{props.count}</span>
        <CaretDown
          class={cn(
            'size-3.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100',
            !open() && '-rotate-90'
          )}
        />
      </button>
      <Show when={open()}>{props.children}</Show>
    </section>
  );
}

export function PrChecksList(props: {
  page: PrPageReadModel;
  density?: PrListDensity;
}) {
  const { actions } = usePrPage();
  const [expanded, setExpanded] = createSignal(false);
  const checks = () => props.page.pullRequest.checks ?? [];
  const visible = createMemo(() => prVisibleChecks(checks(), expanded()));
  const canExpand = () => checks().length > 5;
  return (
    <div class="flex flex-col">
      <For
        each={visible()}
        fallback={
          <Show when={checks().length === 0}>
            <PrListRow density={props.density}>
              <span class="text-ink-muted">{t('prPage.noChecks')}</span>
            </PrListRow>
          </Show>
        }
      >
        {(check) => {
          const state = () => {
            const outcome = checkOutcome(check);
            if (outcome === 'failed') return 'failure';
            if (outcome === 'passed') return 'success';
            if (outcome === 'pending') return 'pending';
            return 'skipped';
          };
          return (
            <PrListRow density={props.density}>
              <CheckStateIcon state={state()} circle size="md" />
              <span class="min-w-0 flex-1 truncate">{check.name}</span>
              <span class="text-xs text-ink-muted">
                {checkDurationText(check, Date.now())}
              </span>
              <Show when={check.url}>
                {(url) => (
                  <a
                    href={url()}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={check.name}
                    class="inline-flex size-6 shrink-0 items-center justify-center"
                  >
                    <ArrowSquareOut class="size-3.5 text-ink-muted" />
                  </a>
                )}
              </Show>
              <Show when={actions.rerunChecks.available()}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('prPage.refresh')}
                  onClick={() =>
                    fireAndForget(
                      Promise.resolve(actions.rerunChecks.run?.(check.id)),
                      'pr-rerun-check'
                    )
                  }
                >
                  <ArrowsClockwise class="size-4" />
                </Button>
              </Show>
            </PrListRow>
          );
        }}
      </For>
      <Show when={canExpand()}>
        <Button
          size="sm"
          variant="ghost"
          class="justify-start text-ink-muted"
          style={{
            'min-height': `${prRowHeight(props.density ?? 'compact')}px`,
          }}
          aria-expanded={expanded()}
          onClick={() => setExpanded(!expanded())}
        >
          <CaretDown class={cn('size-3.5', expanded() && 'rotate-180')} />
          {expanded()
            ? t('prPage.showFewerChecks')
            : t('prPage.showAllChecks', { count: checks().length })}
        </Button>
      </Show>
    </div>
  );
}

export function PrChecksDialog(props: {
  page: PrPageReadModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus?: HTMLButtonElement;
  density?: PrListDensity;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      animate
      class="w-96 max-h-[80dvh] overflow-y-auto rounded-xl"
      onCloseAutoFocus={(event) => {
        if (!props.returnFocus?.isConnected) return;
        event.preventDefault();
        props.returnFocus.focus({ preventScroll: true });
      }}
    >
      <div class="menu-surface flex flex-col gap-3 rounded-xl p-4">
        <div class="flex items-center justify-between gap-3">
          <Dialog.Title class="text-sm font-medium">
            {t('prPage.checks')}
          </Dialog.Title>
          <Dialog.CloseButton
            as={Button}
            size="icon-sm"
            variant="ghost"
            aria-label={t('prPage.close')}
          >
            <X class="size-4" />
          </Dialog.CloseButton>
        </div>
        <PrChecksList page={props.page} density={props.density} />
      </div>
    </Dialog>
  );
}

export function PrReviewerList(props: {
  page: PrPageReadModel;
  density?: PrListDensity;
}) {
  const reviewers = () =>
    props.page.reviewers ??
    props.page.requestedReviewers?.map((person) => ({
      ...person,
      state: 'requested' as const,
    }));
  return (
    <div class="flex flex-col">
      <For each={reviewers()}>
        {(reviewer) => (
          <PrListRow density={props.density}>
            <Show when={reviewer.login}>
              {(login) => <PrGithubAvatar login={login()} />}
            </Show>
            <span class="min-w-0 flex-1 truncate">
              {reviewer.login ?? reviewer.githubUserId}
            </span>
            <Switch>
              <Match when={reviewer.state === 'approved'}>
                <CheckStateIcon state="success" circle size="md" />
                <span class="text-xs text-ink-muted">
                  {t('prPage.approved')}
                </span>
              </Match>
              <Match when={reviewer.state === 'changes_requested'}>
                <CheckStateIcon state="failure" circle size="md" />
                <span class="text-xs text-ink-muted">
                  {t('prPage.changesRequested')}
                </span>
              </Match>
              <Match when={reviewer.state === 'requested'}>
                <CheckStateIcon state="pending" circle size="md" />
                <span class="text-xs text-ink-muted">
                  {t('prPage.requested')}
                </span>
              </Match>
              <Match when={reviewer.state === 'dismissed'}>
                <span class="text-xs text-ink-muted">
                  {t('prPage.dismissed')}
                </span>
              </Match>
              <Match when={reviewer.state === 'commented'}>
                <span class="text-xs text-ink-muted">
                  {t('prPage.commented')}
                </span>
              </Match>
            </Switch>
          </PrListRow>
        )}
      </For>
    </div>
  );
}

export function PrStackList(props: {
  page: PrPageReadModel;
  density?: PrListDensity;
}) {
  return (
    <div class="flex flex-col">
      <For each={props.page.stack?.items}>
        {(item) => (
          <PrListRow
            density={props.density}
            class={
              item.id === props.page.id ? 'rounded-md bg-hover px-2' : undefined
            }
          >
            <PrStatusIcon status={item.status} />
            <Show when={item.number}>
              <span class="text-xs text-ink-muted">#{item.number}</span>
            </Show>
            <span class="min-w-0 flex-1 truncate">{item.title}</span>
          </PrListRow>
        )}
      </For>
    </div>
  );
}

export function PrLabelList(props: { page: PrPageReadModel }) {
  return (
    <GithubLabelPills
      labels={props.page.pullRequest.labels ?? []}
      class="flex-wrap"
    />
  );
}

export function PrFileList(props: {
  page: PrPageReadModel;
  density?: PrListDensity;
  onFile: (path: string) => void;
  filter?: (path: string) => boolean;
}) {
  const { model } = useChanges();
  const { actions } = usePrPage();
  const comments = createMemo(() => props.page.comments);
  const counts = createMemo(() => prFileCommentCounts(comments()));
  return (
    <div class="flex flex-col">
      <For
        each={model.files().filter((file) => props.filter?.(file.path) ?? true)}
      >
        {(file) => (
          <PrListRow density={props.density}>
            <StatusLetter kind={file.kind} />
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-left not-touch:hover:underline"
              title={file.path}
              onClick={() => props.onFile(file.path)}
            >
              {file.path.split('/').at(-1)}
            </button>
            <Show when={counts()[file.path]}>
              <span class="inline-flex items-center gap-1 text-xs text-ink-muted">
                <Chat class="size-3" />
                {counts()[file.path]}
              </span>
            </Show>
            <DiffCounts additions={file.additions} deletions={file.deletions} />
            <Show when={actions.markViewed.available()}>
              <input
                type="checkbox"
                aria-label={t('prPage.markViewed')}
                checked={props.page.viewedFiles?.includes(file.path) ?? false}
                onChange={(event) =>
                  fireAndForget(
                    Promise.resolve(
                      actions.markViewed.run?.(
                        file.path,
                        event.currentTarget.checked
                      )
                    ),
                    'pr-mark-viewed'
                  )
                }
              />
            </Show>
          </PrListRow>
        )}
      </For>
    </div>
  );
}

export function PrLinkedWorkList(props: {
  page: PrPageReadModel;
  density?: PrListDensity;
  onTask: (id: string, event: MouseEvent) => void;
}) {
  return (
    <div class="flex flex-col">
      <For each={props.page.links?.tasks}>
        {(task) => (
          <PrListRow density={props.density}>
            <PrPriorityIcon priority={task.priority} class="size-4 shrink-0" />
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-left not-touch:hover:underline"
              onClick={(event) => props.onTask(task.id, event)}
            >
              {task.name}
            </button>
          </PrListRow>
        )}
      </For>
    </div>
  );
}

export function PrDetailsColumn(props: {
  page: PrPageReadModel;
  onFile: (path: string) => void;
  onTask: (id: string, event: MouseEvent) => void;
  checksOpen?: boolean;
  onChecksOpenChange?: (open: boolean) => void;
  checksRef?: (element: HTMLElement) => void;
}) {
  const { model } = useChanges();
  return (
    <div class="flex min-w-0 flex-col gap-2 px-4 py-2">
      <PrDetailsSection
        title={t('prPage.checks')}
        count={props.page.pullRequest.checks?.length ?? 0}
        open={props.checksOpen}
        onOpenChange={props.onChecksOpenChange}
        sectionRef={props.checksRef}
      >
        <PrChecksList page={props.page} />
      </PrDetailsSection>
      <Show when={props.page.reviewers || props.page.requestedReviewers}>
        <PrDetailsSection
          title={t('prPage.reviewers')}
          count={
            props.page.reviewers?.length ??
            props.page.requestedReviewers?.length
          }
        >
          <PrReviewerList page={props.page} />
        </PrDetailsSection>
      </Show>
      <Show when={props.page.stack}>
        <PrDetailsSection title={t('prPage.stack')}>
          <PrStackList page={props.page} />
        </PrDetailsSection>
      </Show>
      <Show when={props.page.pullRequest.labels?.length}>
        <PrDetailsSection title={t('prPage.labels')}>
          <PrLabelList page={props.page} />
        </PrDetailsSection>
      </Show>
      <Show when={model.files().length}>
        <PrDetailsSection
          title={t('prPage.files')}
          count={model.files().length}
        >
          <PrFileList page={props.page} onFile={props.onFile} />
        </PrDetailsSection>
      </Show>
      <Show when={props.page.links?.tasks.length}>
        <PrDetailsSection title={t('prPage.linkedWork')}>
          <PrLinkedWorkList page={props.page} onTask={props.onTask} />
        </PrDetailsSection>
      </Show>
    </div>
  );
}

export function PrMergeBox(props: { page: PrPageReadModel }) {
  const { actions } = usePrPage();
  const [expanded, setExpanded] = createSignal(false);
  const ready = () =>
    prPageReadyToMerge({
      ...props.page.pullRequest,
      reviewers: props.page.reviewers,
      mergeState: props.page.mergeState,
    }) && actions.changeState.availableFor('merge');
  const waiting = () =>
    props.page.reviewers?.filter((reviewer) => reviewer.state === 'requested');
  const summary = () => {
    if (props.page.checks.failed)
      return t('prPage.failedChecks', { count: props.page.checks.failed });
    if (props.page.checks.pending)
      return t('prPage.runningChecks', { count: props.page.checks.pending });
    if (ready()) return t('prPage.readyToMerge');
    if (props.page.checks.passed)
      return t('prPage.passedChecks', { count: props.page.checks.passed });
    return t('prPage.noChecks');
  };
  const checkState = () => {
    if (props.page.checks.failed) return 'failure';
    if (props.page.checks.pending) return 'pending';
    if (props.page.checks.passed) return 'success';
    return 'none';
  };
  return (
    <Show when={props.page.pullRequest.status === 'open'}>
      <Card variant="raised">
        <Show when={props.page.viewerIsAuthor && waiting()?.length}>
          <Card.Header>
            <span class="text-sm">
              {t('prPage.waitingOn', {
                name:
                  waiting()
                    ?.map((person) => person.login ?? person.githubUserId)
                    .join(', ') ?? '',
              })}
            </span>
          </Card.Header>
        </Show>
        <Card.Body class="flex flex-col gap-3">
          <button
            type="button"
            class="flex w-full items-center gap-2 text-sm"
            aria-expanded={expanded()}
            onClick={() => setExpanded(!expanded())}
          >
            <CheckStateIcon state={checkState()} circle size="md" />
            <span class={ready() ? 'text-success' : undefined}>
              {summary()}
            </span>
            <Show
              when={
                props.page.checks.pending > 0 || props.page.checks.failed > 0
              }
            >
              <span class="text-ink-muted">
                {t('prPage.passedChecks', { count: props.page.checks.passed })}
              </span>
            </Show>
            <span class="flex-1" />
            <CaretDown
              class={cn('size-4 text-ink-muted', expanded() && 'rotate-180')}
            />
          </button>
          <Show when={expanded()}>
            <PrChecksList page={props.page} />
          </Show>
          <Show
            when={
              props.page.mergeState === 'mergeable' && props.page.baseBranch
            }
          >
            <div class="flex items-center gap-2 text-sm text-ink-muted">
              <CheckStateIcon state="success" size="md" />
              <span>
                {t('prPage.noConflicts', {
                  branch: props.page.baseBranch ?? '',
                })}
              </span>
            </div>
          </Show>
          <Show when={props.page.mergeState === 'conflicting'}>
            <div class="text-sm text-failure">{t('prPage.conflicts')}</div>
          </Show>
        </Card.Body>
        <Card.Footer class="flex items-center justify-between gap-3">
          <Show when={!ready() && actions.mergeWhenReady.available()}>
            <ToggleSwitch
              size="sm"
              label={t('prPage.mergeWhenReady')}
              checked={props.page.mergeWhenReady ?? false}
              onChange={(enabled) =>
                fireAndForget(
                  Promise.resolve(actions.mergeWhenReady.run?.(enabled)),
                  'pr-auto-merge'
                )
              }
            />
          </Show>
          <span class="flex-1" />
          <PrMergeButton page={props.page} />
        </Card.Footer>
      </Card>
    </Show>
  );
}

export function PrMergeButton(props: {
  page: PrPageReadModel;
  compact?: boolean;
}) {
  const { actions } = usePrPage();
  const flow = useFlow();
  const enabled = () =>
    prPageReadyToMerge({
      ...props.page.pullRequest,
      mergeState: props.page.mergeState,
      reviewers: props.page.reviewers,
    }) &&
    actions.changeState.availableFor('merge') &&
    !actions.pending();
  return (
    <Button
      size={props.compact ? 'icon-sm' : 'sm'}
      variant={enabled() ? 'success' : 'secondary'}
      disabled={!enabled()}
      aria-label={t('prPage.merge')}
      onClick={() =>
        fireAndForget(
          flow.task('pr.merge', async () => {
            await actions.changeState.run?.('merge');
          }),
          'pr-merge'
        )
      }
    >
      <GitMerge class="size-4" />
      <Show when={!props.compact}>{t('prPage.merge')}</Show>
    </Button>
  );
}
