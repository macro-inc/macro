import { Popover } from '@kobalte/core/popover';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import GithubIcon from '@phosphor/github-logo.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  parseRepositoryInput,
  repositoryLabel,
  validRepositoryBranch,
} from '../core/repository';

/** Explicit, portaled repository/branch controls shared by Home and Agents. */
export function RepositoryPicker(props: {
  repoUrl?: string;
  branch: string;
  recentRepositories: string[];
  onSelect: (url: string | undefined, branch: string) => void;
}) {
  const [repoOpen, setRepoOpen] = createSignal(false);
  const [branchOpen, setBranchOpen] = createSignal(false);
  const [repoInput, setRepoInput] = createSignal('');
  const [branchInput, setBranchInput] = createSignal('');
  const [error, setError] = createSignal('');
  const selectRepo = (url: string | undefined) => {
    props.onSelect(url, url === props.repoUrl ? props.branch : 'main');
    setRepoOpen(false);
  };
  const applyRepo = () => {
    const url = parseRepositoryInput(repoInput());
    if (!url || !url.startsWith('https://github.com/')) {
      setError('Enter a GitHub repository as owner/repo or a repository URL.');
      return;
    }
    selectRepo(url);
  };
  const applyBranch = () => {
    const branch = branchInput().trim();
    if (!validRepositoryBranch(branch)) {
      setError(
        'Enter a valid branch name, for example main or feature/my-change.'
      );
      return;
    }
    props.onSelect(props.repoUrl, branch);
    setBranchOpen(false);
  };
  return (
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <Popover
        open={repoOpen()}
        onOpenChange={(open) => {
          setRepoOpen(open);
          setError('');
          if (open) setRepoInput(props.repoUrl ?? '');
        }}
        placement="top-start"
        gutter={8}
      >
        <Popover.Trigger class="pill max-w-full" aria-label="Repository">
          <GithubIcon class="size-4 shrink-0" />
          <span class="truncate">
            {props.repoUrl ? repositoryLabel(props.repoUrl) : 'Add repository'}
          </span>
          <CaretDownIcon class="size-3 shrink-0" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="z-action-menu w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-edge-muted bg-menu p-3 text-sm text-ink shadow-menu">
            <Popover.Title class="mb-2 font-medium">Repository</Popover.Title>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                applyRepo();
              }}
              class="flex flex-col gap-2"
            >
              <input
                aria-label="Add repository"
                placeholder="owner/repo or GitHub URL"
                value={repoInput()}
                onInput={(event) => {
                  setRepoInput(event.currentTarget.value);
                  setError('');
                }}
                class="w-full rounded-lg border border-edge-muted bg-input px-3 py-2 outline-none focus:border-accent"
              />
              <Show when={error()}>
                <p role="alert" class="text-xs text-failure">
                  {error()}
                </p>
              </Show>
              <Button type="submit" variant="strong">
                Use repository
              </Button>
            </form>
            <div class="mt-2 max-h-48 overflow-y-auto">
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-hover"
                onClick={() => selectRepo(undefined)}
              >
                Choose automatically
                <Show when={!props.repoUrl}>
                  <CheckIcon class="ml-auto size-4" />
                </Show>
              </button>
              <For each={props.recentRepositories}>
                {(url) => (
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-hover"
                    onClick={() => selectRepo(url)}
                  >
                    <GithubIcon class="size-4 shrink-0" />
                    <span class="truncate">{repositoryLabel(url)}</span>
                    <Show when={url === props.repoUrl}>
                      <CheckIcon class="ml-auto size-4 shrink-0" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
      <Show when={props.repoUrl}>
        <Popover
          open={branchOpen()}
          onOpenChange={(open) => {
            setBranchOpen(open);
            setError('');
            if (open) setBranchInput(props.branch);
          }}
          placement="top-start"
          gutter={8}
        >
          <Popover.Trigger class="pill max-w-full" aria-label="Branch">
            <GitBranchIcon class="size-4 shrink-0" />
            <span class="truncate">{props.branch}</span>
            <CaretDownIcon class="size-3 shrink-0" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content class="z-action-menu w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-edge-muted bg-menu p-3 text-sm text-ink shadow-menu">
              <Popover.Title class="mb-2 font-medium">
                Starting branch
              </Popover.Title>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  applyBranch();
                }}
                class="flex flex-col gap-2"
              >
                <input
                  aria-label="Starting branch"
                  placeholder="main or feature/my-change"
                  value={branchInput()}
                  onInput={(event) => {
                    setBranchInput(event.currentTarget.value);
                    setError('');
                  }}
                  class="w-full rounded-lg border border-edge-muted bg-input px-3 py-2 outline-none focus:border-accent"
                />
                <Show when={error()}>
                  <p role="alert" class="text-xs text-failure">
                    {error()}
                  </p>
                </Show>
                <Button type="submit" variant="strong">
                  Use branch
                </Button>
              </form>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      </Show>
    </div>
  );
}
