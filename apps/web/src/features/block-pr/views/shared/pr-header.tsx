import { formatLocale, t } from '@app/lib/i18n';
import { GithubLabelPills } from '@entity/components/GithubLabelPill';
import { CheckStateIcon } from '@entity/composed/list-entity/foreign';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import GitBranch from '@icon/system/regular/git-branch.svg';
import Stack from '@icon/system/regular/stack.svg';
import GithubLogo from '@phosphor/github-logo.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Avatar, Button, cn } from '@ui';
import {
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
  splitProps,
} from 'solid-js';
import { PrPriorityIcon } from '../../component/PrLinks';
import { PrStatusIcon } from '../../component/PrStatus';
import type { PrPageReadModel } from '../../context/pr-page-read-model';
import {
  prLifecycleStatus,
  prStatusBand,
  prStatusTint,
} from '../../primitives/pr-page-state';
import { githubAvatarUrl } from '../../util/githubMarkdown';
import { prHtmlUrl } from '../../util/prKey';

export function PrStatusFade(props: {
  page?: PrPageReadModel;
  strip?: boolean;
}) {
  const band = () =>
    prStatusBand({
      ...props.page?.pullRequest,
      reviewers: props.page?.reviewers,
    });
  const tint = () => prStatusTint(props.page ? band() : 'draft');
  return (
    <div
      aria-hidden="true"
      class={cn(
        'pointer-events-none absolute inset-x-0 top-0 [--pr-tint:var(--pr-tint-light)] dark:[--pr-tint:var(--pr-tint-dark)]',
        props.strip
          ? 'h-full'
          : 'h-[220px] touch:h-[440px] [--pr-tint-hold:0%] touch:[--pr-tint-hold:80%]'
      )}
      style={{
        '--pr-tint-light': tint().lightOpacity,
        '--pr-tint-dark': tint().darkOpacity,
        background: `linear-gradient(to bottom, rgb(from ${tint().color} r g b / var(--pr-tint)) var(--pr-tint-hold, 0%), transparent)`,
      }}
    />
  );
}

export function PrGithubAvatar(props: { login: string; size?: 'sm' | 'md' }) {
  return (
    <Avatar size={props.size ?? 'md'}>
      <Avatar.Image src={githubAvatarUrl(props.login)} alt="" />
      <Avatar.Fallback>{props.login.slice(0, 1).toUpperCase()}</Avatar.Fallback>
    </Avatar>
  );
}

export function PrOpenedDate(props: {
  value?: string | null;
  opened?: boolean;
}) {
  const date = () => {
    const parsed = Date.parse(props.value ?? '');
    return Number.isFinite(parsed) ? new Date(parsed) : undefined;
  };
  return (
    <Show when={date()}>
      {(value) => {
        const label = () =>
          new Intl.DateTimeFormat(formatLocale(), {
            month: 'short',
            day: 'numeric',
          }).format(value());
        return (
          <time datetime={props.value ?? undefined}>
            {props.opened ? t('prPage.openedOn', { date: label() }) : label()}
          </time>
        );
      }}
    </Show>
  );
}

export function PrChecksStatusIcon(props: {
  page: PrPageReadModel;
  onClick: (trigger: HTMLButtonElement) => void;
  size?: 'md' | 'strip';
}) {
  const checks = () => props.page.checks;
  const total = () => props.page.pullRequest.checks?.length ?? 0;
  const state = () => {
    if (checks().failed > 0) return 'failure';
    if (checks().pending > 0) return 'pending';
    if (checks().passed > 0) return 'success';
    return total() > 0 ? 'skipped' : 'none';
  };
  const label = () =>
    t('prPage.checksSummary', { count: checks().passed, total: total() });
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label()}
      tooltip={label()}
      onClick={(event) => props.onClick(event.currentTarget)}
    >
      <CheckStateIcon
        state={state()}
        circle
        size={props.size === 'strip' ? 'lg' : 'md'}
      />
    </Button>
  );
}

export function PrStackPill(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { page: PrPageReadModel }
) {
  const [local, rest] = splitProps(props, ['page', 'class']);
  return (
    <Show when={props.page.stack}>
      {(stack) => (
        <button
          {...rest}
          type="button"
          class={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-hover px-3 py-1 text-xs text-ink-muted not-touch:hover:bg-active touch:min-h-9',
            local.class
          )}
          aria-label={t('prPage.stack')}
        >
          <Stack class="size-3.5" />
          <span>
            {stack().position}/{stack().total}
          </span>
        </button>
      )}
    </Show>
  );
}

export function PrTitleRow(props: {
  page: PrPageReadModel;
  onChecks: (trigger: HTMLButtonElement) => void;
  stack?: JSX.Element;
}) {
  return (
    <div class="flex min-w-0 items-start gap-2.5 touch:gap-2">
      <PrStatusIcon
        status={prLifecycleStatus(props.page.pullRequest)}
        class="mt-1 size-6 shrink-0 touch:size-5"
      />
      <div class="min-w-0 flex-1">
        <h1 class="ph-no-capture inline text-2xl font-semibold leading-snug touch:text-xl">
          {props.page.pullRequest.name}{' '}
          <span class="inline-flex align-middle">
            <PrChecksStatusIcon page={props.page} onClick={props.onChecks} />
          </span>
        </h1>
      </div>
      {props.stack}
    </div>
  );
}

export function PrMiddleBranch(props: { name: string; class?: string }) {
  return (
    <span
      class={cn('inline-flex min-w-0 font-mono', props.class)}
      title={props.name}
    >
      <span class="truncate">{props.name.slice(0, -12)}</span>
      <span class="shrink-0">{props.name.slice(-12)}</span>
    </span>
  );
}

export function PrBranchPill(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    page: PrPageReadModel;
    trailing?: JSX.Element;
  }
) {
  const [local, rest] = splitProps(props, ['page', 'trailing', 'class']);
  return (
    <Show when={props.page.headBranch}>
      {(head) => (
        <button
          {...rest}
          type="button"
          class={cn(
            'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-hover px-3 py-1 text-xs text-ink-muted not-touch:hover:bg-active touch:min-h-9',
            local.class
          )}
          aria-label={t('prPage.branch')}
        >
          <GitBranch class="size-3.5 shrink-0" />
          <PrMiddleBranch name={head()} class="max-w-[220px]" />
          <Show
            when={props.page.baseIsDefault === false && props.page.baseBranch}
          >
            {(base) => (
              <>
                <span aria-hidden="true">→</span>
                <PrMiddleBranch name={base()} class="max-w-[160px]" />
              </>
            )}
          </Show>
          {props.trailing}
        </button>
      )}
    </Show>
  );
}

export function PrMetadataPills(props: {
  page: PrPageReadModel;
  branch?: JSX.Element;
  stack?: JSX.Element;
  onTask: (id: string, event: MouseEvent) => void;
}) {
  return (
    <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs text-ink-muted touch:text-sm">
      <Show when={props.page.pullRequest.authorLogin}>
        {(login) => (
          <a
            href={`https://github.com/${login()}`}
            target="_blank"
            rel="noreferrer"
            class="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-hover px-3 py-1 not-touch:hover:bg-active touch:min-h-9"
          >
            <PrGithubAvatar login={login()} size="sm" />
            <span class="truncate">{login()}</span>
            <PrOpenedDate value={props.page.githubCreatedAt} />
          </a>
        )}
      </Show>
      <PrGithubLinkPill page={props.page} />
      <span class="contents touch:[&:has(button)]:flex touch:[&:has(button)]:w-full">
        {props.branch}
      </span>
      <For each={props.page.links?.tasks}>
        {(task) => (
          <button
            type="button"
            class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-hover px-3 py-1 not-touch:hover:bg-active touch:min-h-9"
            onClick={(event) => props.onTask(task.id, event)}
          >
            <PrPriorityIcon
              priority={task.priority}
              class="size-3.5 shrink-0"
            />
            <span class="truncate">{task.name}</span>
          </button>
        )}
      </For>
      <GithubLabelPills
        labels={props.page.pullRequest.labels ?? []}
        class="contents"
        pillClass="touch:min-h-9"
      />
      {props.stack}
    </div>
  );
}

/** Drop complete GitHub path segments only when the full link cannot fit its row. */
export function PrGithubLinkPill(props: { page: PrPageReadModel }) {
  const [anchor, setAnchor] = createSignal<HTMLAnchorElement>();
  const [full, setFull] = createSignal<HTMLSpanElement>();
  const [repo, setRepo] = createSignal<HTMLSpanElement>();
  const [mode, setMode] = createSignal<'full' | 'repo' | 'number'>('full');
  createResizeObserver(
    () =>
      [anchor()?.parentElement, full(), repo()].filter(
        (element): element is HTMLElement => element != null
      ),
    () => {
      const parent = anchor()?.parentElement;
      const whole = full();
      const repository = repo();
      if (!parent || !whole || !repository) return;
      if (whole.getBoundingClientRect().width <= parent.clientWidth)
        setMode('full');
      else if (repository.getBoundingClientRect().width <= parent.clientWidth)
        setMode('repo');
      else setMode('number');
    }
  );
  return (
    <a
      ref={setAnchor}
      href={props.page.pullRequest.url ?? prHtmlUrl(props.page.prRef)}
      target="_blank"
      rel="noreferrer"
      aria-label={`${props.page.prRef.owner}/${props.page.prRef.repo}#${props.page.prRef.number}`}
      class="relative inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full bg-hover px-3 py-1 not-touch:hover:bg-active touch:min-h-9"
    >
      <GithubLogo class="size-3.5 shrink-0" />
      <span class="inline-flex min-w-0">
        <Switch>
          <Match when={mode() === 'full'}>
            <span>
              {props.page.prRef.owner}/{props.page.prRef.repo}
            </span>
          </Match>
          <Match when={mode() === 'repo'}>
            <span>{props.page.prRef.repo}</span>
          </Match>
        </Switch>
        <span class="text-ink">#{props.page.prRef.number}</span>
      </span>
      <ArrowSquareOut class="size-3.5 shrink-0" />
      <span
        ref={setFull}
        aria-hidden="true"
        class="pointer-events-none invisible fixed left-0 top-0 inline-flex w-max items-center gap-1.5 px-3 py-1"
      >
        <GithubLogo class="size-3.5 shrink-0" />
        <span>
          {props.page.prRef.owner}/{props.page.prRef.repo}#
          {props.page.prRef.number}
        </span>
        <ArrowSquareOut class="size-3.5 shrink-0" />
      </span>
      <span
        ref={setRepo}
        aria-hidden="true"
        class="pointer-events-none invisible fixed left-0 top-0 inline-flex w-max items-center gap-1.5 px-3 py-1"
      >
        <GithubLogo class="size-3.5 shrink-0" />
        <span>
          {props.page.prRef.repo}#{props.page.prRef.number}
        </span>
        <ArrowSquareOut class="size-3.5 shrink-0" />
      </span>
    </a>
  );
}
