import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import ArrowsClockwiseIcon from '@phosphor/arrows-clockwise.svg';
import ArrowsInSimpleIcon from '@phosphor/arrows-in-simple.svg';
import ArrowsOutSimpleIcon from '@phosphor/arrows-out-simple.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CircleNotchIcon from '@phosphor/circle-notch.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import PencilSimpleIcon from '@phosphor/pencil-simple.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn, Dropdown, SegmentedControl } from '@ui';
import { type JSX, Show } from 'solid-js';
import {
  type PullRequestAction,
  pullRequestNumber,
} from '../core/pull-request';

export type DiffStyleValue = 'unified' | 'split';

export type PullRequestControls = {
  /** The session's pull request, once linked; replaces the create button. */
  linkedUrl: string | undefined;
  /** A creation is in flight, so the fast path dims. */
  busy: boolean;
  /** GitHub's compare page can be built for this changeset. */
  canCompare: boolean;
  /** There is a changeset to open a pull request from. */
  enabled: boolean;
  onAction: (action: PullRequestAction) => void;
  onView: () => void;
};

function MenuItem(props: {
  icon: JSX.Element;
  title: string;
  detail: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <Dropdown.Item
      class="items-start gap-2.5 py-2"
      disabled={props.disabled}
      onSelect={props.onSelect}
    >
      <span class="mt-0.5 shrink-0 text-ink-subtle [&>svg]:size-4">
        {props.icon}
      </span>
      <span class="flex min-w-0 flex-col">
        <span class="text-[12.5px] text-ink">{props.title}</span>
        <span class="text-[11px] leading-[1.45] text-ink-placeholder">
          {props.detail}
        </span>
      </span>
    </Dropdown.Item>
  );
}

/**
 * Create-PR is a split button: the fast path is the button, the other three
 * ways to open it live under the caret. Once a pull request exists every
 * create control collapses into one way back to it.
 */
function CreatePullRequestButton(props: { controls: PullRequestControls }) {
  const linkedNumber = () => {
    const url = props.controls.linkedUrl;
    return url ? pullRequestNumber(url) : undefined;
  };
  return (
    <Show
      when={!props.controls.linkedUrl}
      fallback={
        <Button
          variant="outline"
          size="sm"
          class="gap-1.5"
          tooltip="Show the pull request"
          onClick={() => props.controls.onView()}
        >
          <GitPullRequestIcon class="size-3.5" />
          <span>
            {linkedNumber()
              ? `Pull request #${linkedNumber()}`
              : 'Pull request'}
          </span>
        </Button>
      }
    >
      <div
        class="inline-flex items-stretch"
        role="group"
        aria-label="Create pull request"
      >
        <Button
          variant="cta"
          size="sm"
          class="gap-1.5 rounded-r-none"
          disabled={!props.controls.enabled || props.controls.busy}
          tooltip="Open the pull request now, with a title and description written from the diff"
          onClick={() => props.controls.onAction('quick')}
        >
          <Show
            when={!props.controls.busy}
            fallback={<CircleNotchIcon class="size-3.5 animate-spin" />}
          >
            <GitPullRequestIcon class="size-3.5" />
          </Show>
          <span>Create pull request</span>
        </Button>
        <Dropdown placement="bottom-end">
          <Dropdown.Trigger
            variant="cta"
            size="sm"
            class="rounded-l-none px-1.5 shadow-[inset_1px_0_0_var(--color-accent-contrast-muted)]"
            aria-label="Other ways to create the pull request"
            disabled={!props.controls.enabled}
          >
            <CaretDownIcon class="size-3" />
          </Dropdown.Trigger>
          <Dropdown.Content class="w-75">
            <Dropdown.Group>
              <MenuItem
                icon={<GitPullRequestIcon />}
                title="Create pull request"
                detail="One click. The agent writes the title and description from the diff and the session."
                disabled={props.controls.busy}
                onSelect={() => props.controls.onAction('quick')}
              />
              <MenuItem
                icon={<GitBranchIcon />}
                title="Create as draft"
                detail="Same, opened as a draft so reviewers are not notified yet."
                disabled={props.controls.busy}
                onSelect={() => props.controls.onAction('draft')}
              />
            </Dropdown.Group>
            <Dropdown.Separator class="my-1 border-edge-muted" />
            <Dropdown.Group>
              <MenuItem
                icon={<PencilSimpleIcon />}
                title="Edit details first…"
                detail="Read and change the generated title, description, base and reviewers before it opens."
                onSelect={() => props.controls.onAction('edit')}
              />
              <MenuItem
                icon={<ArrowSquareOutIcon />}
                title="Open compare on GitHub"
                detail={
                  props.controls.canCompare
                    ? "Hands off to GitHub's own form for the pushed branch."
                    : 'Needs the branch on GitHub first.'
                }
                disabled={!props.controls.canCompare}
                onSelect={() => props.controls.onAction('github')}
              />
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </div>
    </Show>
  );
}

export function ChangesHeader(props: {
  /** The pane fills the width; the session is off screen. */
  spotlit: boolean;
  /** `head → base`, when known. */
  range: string | undefined;
  /** The linked pull request number, shown in the pill once one exists. */
  diffStyle: DiffStyleValue;
  onDiffStyle: (style: DiffStyleValue) => void;
  pullRequest: PullRequestControls;
  refreshing: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onSpotlight: () => void;
  onClose: () => void;
}) {
  const pill = () => {
    const url = props.pullRequest.linkedUrl;
    const number = url ? pullRequestNumber(url) : undefined;
    if (!props.range) return undefined;
    return number ? `#${number} · ${props.range}` : props.range;
  };
  return (
    <header class="flex h-12 shrink-0 items-center gap-1.5 border-b border-edge pr-2 pl-2.5">
      <Show when={props.spotlit}>
        <Button
          variant="ghost"
          size="icon-sm"
          tooltip="Bring the session back"
          onClick={() => props.onBack()}
        >
          <ArrowLeftIcon />
        </Button>
      </Show>
      <div class="flex min-w-0 items-center gap-1.5">
        <GitBranchIcon class="size-4 shrink-0 text-ink-subtle" />
        <h2 class="truncate text-sm font-semibold text-ink">Changes</h2>
      </div>
      <Show when={pill()}>
        {(text) => (
          <span
            class="inline-flex h-5.5 max-w-64 items-center truncate rounded-full border border-edge-muted px-2 font-mono text-[11px] text-ink-subtle max-lg:hidden"
            title={text()}
          >
            {text()}
          </span>
        )}
      </Show>
      <span class="flex-1" />
      <SegmentedControl
        size="sm"
        aria-label="Diff layout"
        value={props.diffStyle}
        options={[
          { value: 'unified', label: 'Unified' },
          { value: 'split', label: 'Split' },
        ]}
        onChange={props.onDiffStyle}
        class="max-md:hidden"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        tooltip="Capture the changes again"
        disabled={props.refreshing}
        onClick={() => props.onRefresh()}
      >
        <ArrowsClockwiseIcon class={cn(props.refreshing && 'animate-spin')} />
      </Button>
      <CreatePullRequestButton controls={props.pullRequest} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-pressed={props.spotlit}
        tooltip={
          props.spotlit
            ? 'Back to the split'
            : 'Expand changes to the full width'
        }
        onClick={() => props.onSpotlight()}
      >
        {props.spotlit ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        tooltip="Close the changes pane"
        onClick={() => props.onClose()}
      >
        <XIcon />
      </Button>
    </header>
  );
}
