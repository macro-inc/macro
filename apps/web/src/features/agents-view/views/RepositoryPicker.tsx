import { Popover } from '@kobalte/core/popover';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import GitBranchIcon from '@phosphor/git-branch.svg';
import GithubIcon from '@phosphor/github-logo.svg';
import { Button, createCommandListController } from '@ui';
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  filterRepositories,
  orderRepositories,
  type ReachableRepository,
  repositoryLabel,
  sameRepository,
  validRepositoryBranch,
} from '../core/repository';

/** One row of the repository list. */
type RepositoryChoice = { kind: 'automatic' } | { kind: 'listed'; url: string };

/** Explicit, portaled repository/branch controls shared by Home and Agents. */
export function RepositoryPicker(props: {
  repoUrl?: string;
  branch: string;
  /** Repositories the signed-in user can hand a coder through Macro's GitHub App. */
  repositories: ReachableRepository[];
  repositoriesLoading: boolean;
  repositoriesError: boolean;
  /** Repositories handed to coders before, newest first; offered ahead of the rest. */
  recentRepositories: string[];
  onRetryRepositories: () => void;
  /** Where to send someone who reaches no repository yet. */
  onConnectGitHub?: () => void;
  /** `undefined` leaves the choice to the coder. */
  onSelectRepository: (url: string | undefined) => void;
  onSelectBranch: (branch: string) => void;
}) {
  const listId = createUniqueId();
  const [repoOpen, setRepoOpen] = createSignal(false);
  const [branchOpen, setBranchOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [branchInput, setBranchInput] = createSignal('');
  const [error, setError] = createSignal('');

  const offered = createMemo(() =>
    orderRepositories(props.repositories, props.recentRepositories)
  );
  const choices = createMemo<RepositoryChoice[]>(() => {
    const text = search().trim();
    const listed = filterRepositories(offered(), text);
    const choices: RepositoryChoice[] = text ? [] : [{ kind: 'automatic' }];
    for (const repository of listed) {
      choices.push({ kind: 'listed', url: repository.url });
    }
    return choices;
  });
  const choose = (choice: RepositoryChoice) => {
    props.onSelectRepository(
      choice.kind === 'automatic' ? undefined : choice.url
    );
    setRepoOpen(false);
  };
  const list = createCommandListController<RepositoryChoice>({
    items: choices,
    onSelect: choose,
  });
  const highlightedId = () => `${listId}-${list.selectedIndex()}`;
  const scrollHighlightedIntoView = () =>
    document.getElementById(highlightedId())?.scrollIntoView?.({
      block: 'nearest',
    });
  const submitRepository = () => {
    if (list.selectSelected()) return;
    setError('Enter a GitHub repository as owner/repo or a repository URL.');
  };
  const chosen = (choice: RepositoryChoice) =>
    choice.kind === 'automatic'
      ? !props.repoUrl
      : !!props.repoUrl && sameRepository(props.repoUrl, choice.url);
  const rowLabel = (choice: RepositoryChoice) =>
    match(choice)
      .with({ kind: 'automatic' }, () => 'Choose automatically')
      .with({ kind: 'listed' }, ({ url }) => repositoryLabel(url))
      .exhaustive();
  const nothingReachable = () =>
    !props.repositoriesLoading &&
    !props.repositoriesError &&
    offered().length === 0 &&
    !search().trim();

  const applyBranch = () => {
    const branch = branchInput().trim();
    if (!validRepositoryBranch(branch)) {
      setError(
        'Enter a valid branch name, for example main or feature/my-change.'
      );
      return;
    }
    props.onSelectBranch(branch);
    setBranchOpen(false);
  };
  return (
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <Popover
        open={repoOpen()}
        onOpenChange={(open) => {
          setRepoOpen(open);
          setError('');
          if (open) {
            setSearch('');
            list.setSelectedIndex(0);
          }
        }}
        placement="top-start"
        gutter={8}
      >
        <Popover.Trigger class="pill max-w-full" aria-label="Repository">
          <GithubIcon class="size-4 shrink-0" />
          <span class="truncate">
            {props.repoUrl
              ? repositoryLabel(props.repoUrl)
              : 'Choose repository'}
          </span>
          <CaretDownIcon class="size-3 shrink-0" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="z-action-menu w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-edge-muted bg-menu p-3 text-sm text-ink shadow-menu">
            <Popover.Title class="mb-2 font-medium">Repository</Popover.Title>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitRepository();
              }}
              class="flex flex-col gap-2"
            >
              <input
                role="combobox"
                aria-label="Search repositories"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={highlightedId()}
                aria-autocomplete="list"
                autocomplete="off"
                placeholder="Search, or paste owner/repo"
                value={search()}
                onInput={(event) => {
                  setSearch(event.currentTarget.value);
                  setError('');
                  list.setSelectedIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    list.selectNext();
                    scrollHighlightedIntoView();
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    list.selectPrevious();
                    scrollHighlightedIntoView();
                  }
                }}
                class="w-full rounded-lg border border-edge-muted bg-input px-3 py-2 outline-none focus:border-accent"
              />
              <Show when={error()}>
                <p role="alert" class="text-xs text-failure">
                  {error()}
                </p>
              </Show>
            </form>
            <div
              id={listId}
              role="listbox"
              aria-label="Repositories"
              class="mt-2 max-h-56 overflow-y-auto"
            >
              <For each={choices()}>
                {(choice, index) => (
                  <button
                    type="button"
                    role="option"
                    id={`${listId}-${index()}`}
                    aria-selected={list.isSelected(index())}
                    class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-hover aria-selected:bg-active"
                    onClick={() => choose(choice)}
                    onMouseMove={() =>
                      list.setSelectedIndexFromPointer(index())
                    }
                  >
                    <Show when={choice.kind !== 'automatic'}>
                      <GithubIcon class="size-4 shrink-0" />
                    </Show>
                    <span class="truncate">{rowLabel(choice)}</span>
                    <Show when={chosen(choice)}>
                      <CheckIcon class="ml-auto size-4 shrink-0" />
                    </Show>
                  </button>
                )}
              </For>
              <Switch>
                <Match when={props.repositoriesError}>
                  <div class="flex items-center justify-between gap-2 px-2 py-2 text-xs text-ink-muted">
                    Couldn't load your repositories.
                    <Button
                      variant="outline"
                      size="sm"
                      depth={3}
                      onClick={() => props.onRetryRepositories()}
                    >
                      Retry
                    </Button>
                  </div>
                </Match>
                <Match
                  when={props.repositoriesLoading && offered().length === 0}
                >
                  <div class="px-2 py-2 text-xs text-ink-muted">
                    Loading your repositories…
                  </div>
                </Match>
                <Match when={nothingReachable()}>
                  <div class="flex flex-col gap-2 px-2 py-2 text-xs text-ink-muted">
                    No repositories yet. Give Macro's GitHub App access to the
                    repositories your coders should work on.
                    <Show when={props.onConnectGitHub}>
                      <Button
                        variant="outline"
                        size="sm"
                        depth={3}
                        class="self-start"
                        onClick={() => props.onConnectGitHub?.()}
                      >
                        Connect GitHub
                      </Button>
                    </Show>
                  </div>
                </Match>
                <Match when={choices().length === 0}>
                  <div class="px-2 py-2 text-xs text-ink-muted">
                    No repositories match “{search().trim()}”.
                  </div>
                </Match>
              </Switch>
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
