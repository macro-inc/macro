import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createControlFocusScopes } from '@core/util/create-control-focus-scopes';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import GitBranchIcon from '@icon/system/regular/git-branch.svg';
import GithubIcon from '@phosphor/github-logo.svg';
import { Button, createCommandListController, Dropdown, Input } from '@ui';
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  filterBranches,
  filterRepositories,
  orderBranches,
  orderRepositories,
  type ReachableRepository,
  repositoryLabel,
  sameRepository,
  validRepositoryBranch,
} from '../core/repository';

/** One row of the repository list. */
type RepositoryChoice = { kind: 'automatic' } | { kind: 'listed'; url: string };

/** One row of the branch list. */
type BranchChoice =
  | { kind: 'listed'; name: string }
  /** Named by hand rather than listed; the session starts from this ref. */
  | { kind: 'typed'; name: string };

/** Explicit, portaled repository/branch controls shared by Home and Agents. */
export function RepositoryPicker(props: {
  repoUrl?: string;
  /** Use the joined repository/branch pill in the phone accessory only. */
  compactPhone?: boolean;
  onOpenChange?: (open: boolean) => void;
  onFocusScopeChange?: (active: boolean) => void;
  branch: string;
  /** This runtime always starts new worktrees from main. */
  branchLocked?: boolean;
  /** Repositories the signed-in user can hand a coder through Macro's GitHub App. */
  repositories: ReachableRepository[];
  repositoriesLoading: boolean;
  repositoriesError: boolean;
  /** Repositories handed to coders before, newest first; offered ahead of the rest. */
  recentRepositories: string[];
  onRetryRepositories: () => void;
  /** Branch names on the selected repository, as GitHub listed them. */
  branches: string[];
  branchesLoading: boolean;
  branchesError: boolean;
  onRetryBranches: () => void;
  /** Where to send someone who reaches no repository yet. */
  onConnectGitHub?: () => void;
  /** `undefined` leaves the choice to the coder. */
  onSelectRepository: (url: string | undefined) => void;
  onSelectBranch: (branch: string) => void;
}) {
  const listId = createUniqueId();
  const setFocusScope = createControlFocusScopes<'repository' | 'branch'>(
    (active) => props.onFocusScopeChange?.(active)
  );
  const [repoOpen, updateRepoOpen] = createSignal(false);
  const [branchOpen, updateBranchOpen] = createSignal(false);
  const setRepoOpen = (open: boolean) => {
    if (open) setFocusScope('repository', true);
    updateRepoOpen(open);
    props.onOpenChange?.(open || branchOpen());
  };
  const setBranchOpen = (open: boolean) => {
    if (open) setFocusScope('branch', true);
    updateBranchOpen(open);
    props.onOpenChange?.(open || repoOpen());
  };
  const [search, setSearch] = createSignal('');
  const [branchSearch, setBranchSearch] = createSignal('');
  const [error, setError] = createSignal('');
  const branchListId = createUniqueId();

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
  const selectedRepository = () => {
    const choice = choices().find(chosen);
    return choice?.kind === 'listed' ? choice.url : '';
  };
  const rowLabel = (choice: RepositoryChoice) =>
    match(choice)
      .with({ kind: 'automatic' }, () => 'Auto-detect')
      .with({ kind: 'listed' }, ({ url }) => repositoryLabel(url))
      .exhaustive();
  const nothingReachable = () =>
    !props.repositoriesLoading &&
    !props.repositoriesError &&
    offered().length === 0 &&
    !search().trim();

  const defaultBranch = () => {
    const url = props.repoUrl;
    return url
      ? props.repositories.find((repository) =>
          sameRepository(repository.url, url)
        )?.defaultBranch
      : undefined;
  };
  const offeredBranches = createMemo(() => {
    const listed = orderBranches(props.branches, defaultBranch());
    // Keep a chosen or default name visible while listing, or when GitHub
    // has other branches but not this one. An empty successful listing is
    // an empty repository: offer a typed name instead of inventing one.
    const keepCurrent =
      !!props.branch &&
      validRepositoryBranch(props.branch) &&
      !listed.includes(props.branch) &&
      (listed.length > 0 || props.branchesLoading || props.branchesError);
    return keepCurrent ? [props.branch, ...listed] : listed;
  });
  const branchChoices = createMemo<BranchChoice[]>(() => {
    const text = branchSearch().trim();
    const listed = filterBranches(offeredBranches(), text);
    const choices: BranchChoice[] = listed.map((name) => ({
      kind: 'listed' as const,
      name,
    }));
    if (validRepositoryBranch(text) && !listed.includes(text)) {
      choices.push({ kind: 'typed', name: text });
    }
    return choices;
  });
  const chooseBranch = (choice: BranchChoice) => {
    props.onSelectBranch(choice.name);
    setBranchOpen(false);
  };
  const branchList = createCommandListController<BranchChoice>({
    items: branchChoices,
    onSelect: chooseBranch,
  });
  const highlightedBranchId = () =>
    `${branchListId}-${branchList.selectedIndex()}`;
  const scrollHighlightedBranchIntoView = () =>
    document.getElementById(highlightedBranchId())?.scrollIntoView?.({
      block: 'nearest',
    });
  const submitBranch = () => {
    if (branchList.selectSelected()) return;
    setError(
      'Enter a valid branch name, for example main or feature/my-change.'
    );
  };
  const nothingListed = () =>
    !props.branchesLoading &&
    !props.branchesError &&
    offeredBranches().length === 0 &&
    !branchSearch().trim();
  return (
    <div
      class={
        props.compactPhone
          ? 'flex min-w-0 w-fit max-w-full items-center gap-0 rounded-full border border-edge bg-chrome px-1'
          : 'flex min-w-0 w-full items-center gap-2'
      }
    >
      <RepositoryPickerMenu
        open={repoOpen()}
        onCloseFocus={() => {
          if (!repoOpen()) setFocusScope('repository', false);
        }}
        onOpenChange={(open) => {
          setRepoOpen(open);
          setError('');
          if (open) {
            setSearch('');
            list.setSelectedIndex(0);
          }
        }}
        label="Repository"
        triggerClass={
          props.compactPhone
            ? `pill min-w-0 shrink-0 h-9 px-2 gap-2 text-ink ${props.repoUrl ? 'max-w-[70%]' : 'max-w-full'}`
            : 'pill min-w-0 max-w-full text-ink'
        }
        trigger={
          <>
            <GithubIcon class="size-4 shrink-0" />
            <span class="truncate">
              {props.repoUrl ? repositoryLabel(props.repoUrl) : 'Auto-detect'}
            </span>
            <Show when={!props.compactPhone || !props.repoUrl}>
              <CaretDownIcon class="size-3 shrink-0" />
            </Show>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitRepository();
          }}
          class="flex flex-col gap-2"
        >
          <Input
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
              if (event.key !== 'Escape') event.stopPropagation();
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
            class="w-full"
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
          <RepositoryPickerOptions value={selectedRepository()}>
            <For each={choices()}>
              {(choice, index) => (
                <RepositoryPickerOption
                  value={choice.kind === 'automatic' ? '' : choice.url}
                  id={`${listId}-${index()}`}
                  highlighted={list.isSelected(index())}
                  selected={chosen(choice)}
                  onSelect={() => choose(choice)}
                  onMouseMove={() => list.setSelectedIndexFromPointer(index())}
                >
                  <Show when={choice.kind !== 'automatic'}>
                    <GithubIcon class="size-4 shrink-0" />
                  </Show>
                  <span class="truncate">{rowLabel(choice)}</span>
                </RepositoryPickerOption>
              )}
            </For>
          </RepositoryPickerOptions>
          <Switch>
            <Match when={props.repositoriesError}>
              <div class="flex items-center justify-between gap-2 px-2 py-2 text-xs text-ink-muted">
                Couldn't load your repositories.
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => props.onRetryRepositories()}
                >
                  Retry
                </Button>
              </div>
            </Match>
            <Match when={props.repositoriesLoading && offered().length === 0}>
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
                    variant="secondary"
                    size="sm"
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
      </RepositoryPickerMenu>
      <Show when={props.repoUrl}>
        <RepositoryPickerMenu
          open={branchOpen()}
          onCloseFocus={() => {
            if (!branchOpen()) setFocusScope('branch', false);
          }}
          onOpenChange={(open) => {
            setBranchOpen(open && !props.branchLocked);
            setError('');
            if (open) {
              setBranchSearch('');
              const selected = offeredBranches().indexOf(props.branch);
              branchList.setSelectedIndex(selected >= 0 ? selected : 0);
            }
          }}
          label="Starting branch"
          triggerLabel="Branch"
          triggerClass={
            props.compactPhone
              ? 'pill min-w-0 max-w-full flex-1 h-9 pl-1 pr-2 gap-2 text-ink'
              : 'pill min-w-0 max-w-[45%] text-ink'
          }
          disabled={props.branchLocked}
          title={
            props.branchLocked
              ? 'New local sessions start from main'
              : undefined
          }
          trigger={
            <>
              <GitBranchIcon class="size-4 shrink-0" />
              <span
                class="truncate"
                classList={{
                  'font-mono text-[13px] text-ink-muted': props.compactPhone,
                }}
              >
                {props.branch}
              </span>
              <Show when={!props.branchLocked}>
                <CaretDownIcon class="size-3 shrink-0" />
              </Show>
            </>
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitBranch();
            }}
            class="flex flex-col gap-2"
          >
            <Input
              role="combobox"
              aria-label="Search branches"
              aria-expanded="true"
              aria-controls={branchListId}
              aria-activedescendant={highlightedBranchId()}
              aria-autocomplete="list"
              autocomplete="off"
              placeholder="Search, or type a branch name"
              value={branchSearch()}
              onInput={(event) => {
                setBranchSearch(event.currentTarget.value);
                setError('');
                branchList.setSelectedIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') event.stopPropagation();
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  branchList.selectNext();
                  scrollHighlightedBranchIntoView();
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  branchList.selectPrevious();
                  scrollHighlightedBranchIntoView();
                }
              }}
              class="w-full"
            />
            <Show when={error()}>
              <p role="alert" class="text-xs text-failure">
                {error()}
              </p>
            </Show>
          </form>
          <div
            id={branchListId}
            role="listbox"
            aria-label="Branches"
            class="mt-2 max-h-56 overflow-y-auto"
          >
            <RepositoryPickerOptions value={props.branch}>
              <For each={branchChoices()}>
                {(choice, index) => (
                  <RepositoryPickerOption
                    value={choice.name}
                    id={`${branchListId}-${index()}`}
                    highlighted={branchList.isSelected(index())}
                    selected={choice.name === props.branch}
                    onSelect={() => chooseBranch(choice)}
                    onMouseMove={() =>
                      branchList.setSelectedIndexFromPointer(index())
                    }
                  >
                    <GitBranchIcon class="size-4 shrink-0" />
                    <span class="min-w-0 truncate">
                      {choice.kind === 'typed'
                        ? `Use ${choice.name}`
                        : choice.name}
                    </span>
                    <Show when={choice.name === defaultBranch()}>
                      <span class="shrink-0 text-xs text-ink-muted">
                        {` (default)`}
                      </span>
                    </Show>
                  </RepositoryPickerOption>
                )}
              </For>
            </RepositoryPickerOptions>
            <Switch>
              <Match when={props.branchesError}>
                <div class="flex items-center justify-between gap-2 px-2 py-2 text-xs text-ink-muted">
                  Couldn't load this repository's branches.
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => props.onRetryBranches()}
                  >
                    Retry
                  </Button>
                </div>
              </Match>
              <Match
                when={props.branchesLoading && props.branches.length === 0}
              >
                <div class="px-2 py-2 text-xs text-ink-muted">
                  Loading branches…
                </div>
              </Match>
              <Match when={nothingListed()}>
                <div class="px-2 py-2 text-xs text-ink-muted">
                  No branches yet. Type a starting branch to use.
                </div>
              </Match>
              <Match when={branchChoices().length === 0}>
                <div class="px-2 py-2 text-xs text-ink-muted">
                  No branches match “{branchSearch().trim()}”.
                </div>
              </Match>
            </Switch>
          </div>
        </RepositoryPickerMenu>
      </Show>
    </div>
  );
}

/** Keep repository and branch pickers in the platform's standard overlay. */
function RepositoryPickerMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseFocus: () => void;
  label: string;
  triggerLabel?: string;
  triggerClass: string;
  disabled?: boolean;
  title?: string;
  trigger: JSX.Element;
  children: JSX.Element;
}) {
  let content: HTMLDivElement | undefined;
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dropdown
          open={props.open}
          onOpenChange={props.onOpenChange}
          placement="top-start"
        >
          <Dropdown.Trigger
            variant="ghost"
            class="min-w-0 max-w-full"
            aria-label={props.triggerLabel ?? props.label}
            disabled={props.disabled}
            title={props.title}
          >
            {props.trigger}
          </Dropdown.Trigger>
          <Dropdown.Content
            onCloseAutoFocus={() => queueMicrotask(props.onCloseFocus)}
            class="w-80 max-w-[calc(100vw-1rem)]"
            ref={(element: HTMLDivElement) => {
              content = element;
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              setTimeout(() => {
                if (content?.isConnected)
                  content
                    .querySelector<HTMLInputElement>('[role="combobox"]')
                    ?.focus();
              }, 0);
            }}
          >
            <Dropdown.Group>
              <Dropdown.GroupLabel>{props.label}</Dropdown.GroupLabel>
              {props.children}
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      }
    >
      <MobileDrawer
        side="bottom"
        open={props.open}
        onOpenChange={props.onOpenChange}
        onFinalFocus={() => queueMicrotask(props.onCloseFocus)}
        restoreFocus
      >
        <MobileDrawer.Trigger
          class={props.triggerClass}
          aria-label={props.triggerLabel ?? props.label}
          disabled={props.disabled}
          title={props.title}
          onPointerDown={(event: PointerEvent) => event.preventDefault()}
          onMouseDown={(event: MouseEvent) => event.preventDefault()}
        >
          {props.trigger}
        </MobileDrawer.Trigger>
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content>
            <MobileDrawer.Handle />
            <MobileDrawer.Title class="px-4 pb-3 font-medium">
              {props.label}
            </MobileDrawer.Title>
            <MobileDrawer.ScrollBody>
              <MobileDrawer.Section>{props.children}</MobileDrawer.Section>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}

/** Keep sheet options on touch and shared radio-item styling on desktop. */
function RepositoryPickerOptions(props: {
  value: string;
  children: JSX.Element;
}) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dropdown.RadioGroup value={props.value}>
          {props.children}
        </Dropdown.RadioGroup>
      }
    >
      {props.children}
    </Show>
  );
}

function RepositoryPickerOption(props: {
  value: string;
  id: string;
  highlighted: boolean;
  selected: boolean;
  onSelect: () => void;
  onMouseMove: () => void;
  children: JSX.Element;
}) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Dropdown.RadioItem
          value={props.value}
          id={props.id}
          role="option"
          aria-selected={props.highlighted}
          data-highlighted={props.highlighted ? '' : undefined}
          onSelect={props.onSelect}
          onMouseMove={props.onMouseMove}
        >
          <Dropdown.ItemLabel class="flex min-w-0 flex-1 items-center gap-1.5">
            {props.children}
          </Dropdown.ItemLabel>
          <Dropdown.ItemIndicator>
            <CheckIcon class="size-3.5 shrink-0 text-accent" />
          </Dropdown.ItemIndicator>
        </Dropdown.RadioItem>
      }
    >
      <MobileDrawer.Item
        id={props.id}
        role="option"
        aria-selected={props.highlighted}
        aria-checked={props.selected}
        onClick={props.onSelect}
        onMouseMove={props.onMouseMove}
      >
        <span class="flex min-w-0 flex-1 items-center gap-1.5">
          {props.children}
        </span>
        <Show when={props.selected}>
          <CheckIcon class="size-4.5 shrink-0 text-accent" />
        </Show>
      </MobileDrawer.Item>
    </Show>
  );
}
