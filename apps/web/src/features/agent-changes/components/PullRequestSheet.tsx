/**
 * The pull request composer over the pane: the drafted title and
 * description to adjust, the base and reviewers, then the agent's progress
 * and the opened pull request.
 */

import { DiffChanges, TextShimmer } from '@app/features/block-agent/ui';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import CheckIcon from '@phosphor/check.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { Button, Checkbox, cn, Input } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  type Changeset,
  describeFileCount,
  repositorySlug,
} from '../core/changeset';
import {
  type PullRequestForm,
  type PullRequestSheet as PullRequestSheetState,
  parseReviewers,
  pullRequestNumber,
} from '../core/pull-request';

function BranchPill(props: { children: JSX.Element; mono?: boolean }) {
  return (
    <span
      class={cn(
        'inline-flex h-5.5 max-w-full items-center gap-1.5 truncate rounded-full border border-edge-muted px-2 text-[11px] text-ink-subtle',
        props.mono !== false && 'font-mono'
      )}
    >
      {props.children}
    </span>
  );
}

function BranchLine(props: { changeset: Changeset; class?: string }) {
  return (
    <div
      class={cn(
        'flex flex-wrap items-center gap-2 text-xs text-ink-placeholder',
        props.class
      )}
    >
      <Show when={props.changeset.head.name}>
        {(head) => (
          <BranchPill>
            <GitBranchIcon class="size-3 shrink-0" />
            {head()}
          </BranchPill>
        )}
      </Show>
      <Show when={props.changeset.base.name}>
        {(base) => (
          <>
            <span>into</span>
            <BranchPill>
              <GitBranchIcon class="size-3 shrink-0" />
              {base()}
            </BranchPill>
          </>
        )}
      </Show>
      <span class="inline-flex items-center gap-1.5">
        · {describeFileCount(props.changeset.files.length)} ·
        <DiffChanges
          additions={props.changeset.additions}
          deletions={props.changeset.deletions}
        />
      </span>
    </div>
  );
}

function Field(props: {
  label: string;
  for?: string;
  children: JSX.Element;
  trailing?: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <label
          for={props.for}
          class="text-[11px] tracking-[0.06em] text-ink-placeholder uppercase"
        >
          {props.label}
        </label>
        <span class="flex-1" />
        {props.trailing}
      </div>
      {props.children}
    </div>
  );
}

function Form(props: {
  form: PullRequestForm;
  drafting: boolean;
  error: string | undefined;
  changeset: Changeset;
  onChange: (patch: Partial<PullRequestForm>) => void;
  onRegenerate: () => void;
  onSubmit: () => void;
  onOpenCompare: () => void;
  onClose: () => void;
}) {
  const slug = () => repositorySlug(props.changeset.repository);
  return (
    <div class="flex flex-col gap-4">
      <div>
        <h2 class="text-[17px] font-semibold tracking-[-0.015em] text-ink">
          Create pull request
        </h2>
        <BranchLine changeset={props.changeset} class="mt-2" />
      </div>

      <Field label="Title" for="pr-title">
        <Input
          id="pr-title"
          value={props.form.title}
          disabled={props.drafting}
          placeholder={
            props.drafting ? 'Writing…' : 'One line, imperative mood'
          }
          onInput={(event) =>
            props.onChange({ title: event.currentTarget.value })
          }
        />
      </Field>

      <Field
        label="Description"
        for="pr-body"
        trailing={
          <>
            <span class="text-[11px] text-ink-disabled">
              written by the agent
            </span>
            <Button
              variant="ghost"
              size="xs"
              class="h-6 gap-1 px-1.5 text-[11px]"
              disabled={props.drafting}
              onClick={() => props.onRegenerate()}
            >
              <SparkleIcon class="size-3" />
              <Show
                when={!props.drafting}
                fallback={<TextShimmer text="Writing…" active />}
              >
                Regenerate
              </Show>
            </Button>
          </>
        }
      >
        <textarea
          id="pr-body"
          class={cn(
            'min-h-47 w-full resize-y rounded-lg border border-edge bg-input px-3 py-2 font-mono text-xs leading-[19px] text-ink outline-none placeholder:text-ink-placeholder focus:border-input-focus',
            props.drafting && 'opacity-50'
          )}
          value={props.form.body}
          disabled={props.drafting}
          placeholder={
            props.drafting
              ? 'Writing the description from the diff…'
              : 'What changed, and why.'
          }
          onInput={(event) =>
            props.onChange({ body: event.currentTarget.value })
          }
        />
      </Field>

      <div class="flex flex-wrap gap-3 *:min-w-0 *:flex-[1_1_220px]">
        <Field label="Base branch" for="pr-base">
          <Input
            id="pr-base"
            value={props.form.base}
            placeholder="main"
            onInput={(event) =>
              props.onChange({ base: event.currentTarget.value })
            }
          />
        </Field>
        <Field label="Reviewers" for="pr-reviewers">
          <Input
            id="pr-reviewers"
            value={props.form.reviewers.join(', ')}
            placeholder="GitHub logins, comma separated"
            onChange={(event) =>
              props.onChange({
                reviewers: parseReviewers(event.currentTarget.value),
              })
            }
          />
          <Show when={props.form.reviewers.length > 0}>
            <div class="flex flex-wrap gap-1.5">
              <For each={props.form.reviewers}>
                {(reviewer) => (
                  <BranchPill mono={false}>@{reviewer}</BranchPill>
                )}
              </For>
            </div>
          </Show>
        </Field>
      </div>

      <Checkbox
        checked={props.form.draft}
        onChange={(draft) => props.onChange({ draft })}
      >
        <Checkbox.Control />
        <Checkbox.Label class="text-sm text-ink-muted">
          Open as a draft
        </Checkbox.Label>
      </Checkbox>

      <p class="text-xs leading-relaxed text-ink-placeholder">
        The agent pushes the branch, opens the pull request, and links it to
        this session. Review notes stay in the session; they are not posted to
        GitHub.
      </p>

      <Show when={props.error}>
        {(error) => (
          <p class="text-xs text-failure" role="alert">
            {error()}
          </p>
        )}
      </Show>

      <div class="flex flex-wrap items-center gap-2 pt-1">
        <Button
          variant="cta"
          size="sm"
          class="gap-1.5"
          disabled={props.drafting}
          onClick={() => props.onSubmit()}
        >
          <GitPullRequestIcon class="size-3.5" />
          <span>
            {props.form.draft
              ? 'Create draft pull request'
              : 'Create pull request'}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="gap-1.5"
          onClick={() => props.onOpenCompare()}
        >
          <ArrowSquareOutIcon class="size-3.5" />
          <span>Open on GitHub instead</span>
        </Button>
        <Button variant="outline" size="sm" onClick={() => props.onClose()}>
          Cancel
        </Button>
        <span class="flex-1" />
        <Show when={props.changeset.head.name && slug()}>
          <span class="text-xs text-ink-placeholder">
            Pushes{' '}
            <b class="font-medium text-ink-muted">
              {props.changeset.head.name}
            </b>{' '}
            to <b class="font-medium text-ink-muted">{slug()}</b>
          </span>
        </Show>
      </div>
    </div>
  );
}

function Progress(props: {
  title: string;
  detail: string;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div class="flex flex-col items-start gap-3">
      <span class="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <SparkleIcon class="size-4 text-accent" />
        <TextShimmer text={props.title} active />
      </span>
      <p class="max-w-md text-xs leading-relaxed text-ink-muted">
        {props.detail}
      </p>
      <Button variant="outline" size="sm" onClick={() => props.onClose()}>
        {props.closeLabel}
      </Button>
    </div>
  );
}

function Opened(props: {
  url: string;
  title: string | undefined;
  changeset: Changeset;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}) {
  const number = () => pullRequestNumber(props.url);
  const slug = () => repositorySlug(props.changeset.repository);
  return (
    <div class="flex flex-col items-start gap-3.5">
      <span class="inline-flex items-center gap-2 rounded-full bg-success/15 py-1 pr-3 pl-2 text-[12.5px] font-semibold text-success">
        <CheckIcon class="size-4" />
        {number() ? `Pull request #${number()} opened` : 'Pull request opened'}
      </span>
      <div>
        <h2 class="text-[17px] font-semibold tracking-[-0.015em] text-ink">
          {props.title ?? 'Pull request'}
        </h2>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <Show when={slug() && number()}>
            <BranchPill>
              {slug()} #{number()}
            </BranchPill>
          </Show>
          <Show when={props.changeset.head.name}>
            <BranchPill>
              <GitBranchIcon class="size-3 shrink-0" />
              {props.changeset.head.name}
              <Show when={props.changeset.base.name}>
                {' '}
                → {props.changeset.base.name}
              </Show>
            </BranchPill>
          </Show>
        </div>
      </div>
      <p class="max-w-md text-xs leading-relaxed text-ink-placeholder">
        This session is linked to the pull request. The agent can push
        follow-ups to the same branch, and review notes you send from here land
        in the session.
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="cta"
          size="sm"
          class="gap-1.5"
          onClick={() => props.onOpenUrl(props.url)}
        >
          <ArrowSquareOutIcon class="size-3.5" />
          <span>Open on GitHub</span>
        </Button>
        <Button variant="outline" size="sm" onClick={() => props.onClose()}>
          Back to changes
        </Button>
      </div>
    </div>
  );
}

export function PullRequestSheet(props: {
  sheet: PullRequestSheetState;
  changeset: Changeset;
  onChange: (patch: Partial<PullRequestForm>) => void;
  onRegenerate: () => void;
  onSubmit: () => void;
  onOpenCompare: () => void;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      class="absolute inset-x-0 top-12 bottom-0 z-10 flex flex-col overflow-y-auto bg-panel"
      role="dialog"
      aria-label="Create pull request"
      onKeyDown={(event) => {
        if (event.key === 'Escape') props.onClose();
      }}
    >
      <div class="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-5 pt-5.5 pb-10">
        <Switch>
          <Match when={props.sheet.kind === 'drafting'}>
            <Progress
              title="Writing the title and description from the diff…"
              detail="The pull request opens as soon as the draft is ready."
              closeLabel="Cancel"
              onClose={props.onClose}
            />
          </Match>
          <Match when={props.sheet.kind === 'form' ? props.sheet : undefined}>
            {(sheet) => (
              <Form
                form={sheet().form}
                drafting={sheet().drafting}
                error={sheet().error}
                changeset={props.changeset}
                onChange={props.onChange}
                onRegenerate={props.onRegenerate}
                onSubmit={props.onSubmit}
                onOpenCompare={props.onOpenCompare}
                onClose={props.onClose}
              />
            )}
          </Match>
          <Match when={props.sheet.kind === 'creating'}>
            <Progress
              title="Asking the agent to open the pull request…"
              detail="The agent pushes the branch and opens the pull request; the transcript shows its progress. This sheet updates when the pull request exists, and the header shows it from then on."
              closeLabel="Back to changes"
              onClose={props.onClose}
            />
          </Match>
          <Match when={props.sheet.kind === 'opened' ? props.sheet : undefined}>
            {(sheet) => (
              <Opened
                url={sheet().url}
                title={sheet().title}
                changeset={props.changeset}
                onOpenUrl={props.onOpenUrl}
                onClose={props.onClose}
              />
            )}
          </Match>
        </Switch>
      </div>
    </div>
  );
}
