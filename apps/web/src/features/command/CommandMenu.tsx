import { isListViewID } from '@app/constants/list-views';
import { useCrmContactDiscovery } from '@app/features/crm/record-adapter';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { enableProjects } from '@core/constant/featureFlags';
import { getActiveCommandsFromScope } from '@core/hotkey/getCommands';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import {
  hotkeyScopeTree,
  setActiveScope,
  setPressedKeys,
} from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import type { HotkeyCommand, RegisterHotkeyReturn } from '@core/hotkey/types';
import { runCommand } from '@core/hotkey/utils';
import { debouncedDependent } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import { lazyNamed } from '@core/util/lazyNamed';
import type { EntityData } from '@entity';
import { EntitySelectionBadge } from '@entity/components/EntitySelectionBadge';
import Macro from '@icon/macro-logo.svg';
import ArrowLeft from '@icon/system/regular/arrow-left.svg';
import { useDatabaseDiscoverySync } from '@queries/storage/databases';
import {
  Badge,
  CommandMenuHotkeyHint,
  CommandMenuSearchInput,
  CommandMenuShell,
  cn,
  createCommandListController,
  Dialog,
  Hotkey,
  Tabs,
} from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import type { InputLayoutParts } from '../universal-input/context/capabilities';
import { useUniversalInputEnabled } from '../universal-input/use-universal-input';
import { defaultCommandResultIndex } from './core/default-result-index';
import { shouldUseUniversalInput } from './core/universal-input-mode';
import { createCommandResultOpener } from './open-command-result';
import { trackCommandUsage } from './recency';
import { CommandState } from './state';
import type { CategoryFilter } from './types';
import {
  type CommandMenuItem,
  isAskAiItem,
  isCommandItem,
  isEntityItem,
  isSearchItem,
  isUserItem,
  useCommandItems,
} from './useCommandItems';
import { CommandResults } from './views/command-results';

const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  {
    id: 'all',
    get label() {
      return t('commandMenu.categoryAll');
    },
  },
  {
    id: 'commands',
    get label() {
      return t('commandMenu.categoryCommands');
    },
  },
  {
    id: 'chats',
    get label() {
      return t('commandMenu.categoryAgents');
    },
  },
  {
    id: 'documents',
    get label() {
      return t('commandMenu.categoryFiles');
    },
  },
  {
    id: 'tasks',
    get label() {
      return t('commandMenu.categoryTasks');
    },
  },
  {
    id: 'projects',
    get label() {
      return t('commandMenu.categoryProjects');
    },
  },
  {
    id: 'channels',
    get label() {
      return t('commandMenu.categoryChannels');
    },
  },
  {
    id: 'dms',
    get label() {
      return t('commandMenu.categoryPeople');
    },
  },
];

const CommandUniversalInput = lazyNamed(
  () => import('../universal-input/universal-input'),
  'CommandUniversalInput'
);

export function CommandMenu() {
  const splitManager = globalSplitManager();
  const isListMode = splitManager
    ? () => isListViewID(splitManager.activeSplit()?.content().id)
    : () => true; // assume list mode

  let suppressCloseAutoFocus = false;

  createEffect(() => {
    const open = CommandState.isOpen();
    if (!isListMode()) {
      CommandState.clearEntityActionEntities();
    }
    if (open) {
      CommandState.onMenuOpen();
      suppressCloseAutoFocus = false;
    } else {
      CommandState.onMenuClose();
    }
  });

  const handleSelect = (item: CommandMenuItem) => {
    if (
      isSearchItem(item) ||
      isAskAiItem(item) ||
      item.kind === 'new-project' ||
      (isCommandItem(item) &&
        item.data.hotkeyToken === TOKENS.global.createCommand)
    )
      suppressCloseAutoFocus = true;
  };

  return (
    <Dialog
      class="[&>[data-command-menu]>[data-layer]>[data-surface]]:border-0! [&>[data-command-menu]>[data-layer]>[data-surface]]:bg-transparent [&>[data-command-menu]>[data-layer]>[data-surface]]:rounded-[24px]"
      onOpenChange={CommandState.setIsOpen}
      onCloseAutoFocus={(e) => {
        if (suppressCloseAutoFocus) {
          e.preventDefault();
          suppressCloseAutoFocus = false;
        }
      }}
      open={CommandState.isOpen()}
    >
      <CommandMenuInner
        depth={2}
        onSelect={handleSelect}
        onHint={() => {
          suppressCloseAutoFocus = true;
        }}
      />
    </Dialog>
  );
}

type CommandMenuInnerProps = {
  /** Override items source with custom data (e.g. sandbox entities for tutorial) */
  items?: () => CommandMenuItem[];
  /** Called when the user selects an item from the menu */
  onSelect?: (item: CommandMenuItem) => void;
  /** Called when the user takes the menu's hint (it moves focus itself). */
  onHint?: () => void;
  /**
   * When true, selecting an item only fires `onSelect` — no navigation,
   * command, or search is run. Used by the onboarding sandbox so selecting a
   * sandbox entity doesn't navigate the real app to a non-existent doc.
   */
  disableDefaultAction?: boolean;
  /** Optional class merged onto the Panel wrapper. */
  class?: string;
  /** Optional depth for the Panel wrapper. */
  depth?: 0 | 1 | 2 | 3 | 4;
};

export function CommandMenuInner(props: CommandMenuInnerProps) {
  const universalInputEnabled = useUniversalInputEnabled();
  const [expanded, setExpanded] = createSignal(false);
  let selection = { start: 0, end: 0 };
  let typing = false;
  let composing = false;
  let input: HTMLTextAreaElement | undefined;
  let ready = false;
  let disposed = false;
  let loading: Promise<unknown> | undefined;
  const eligible = () =>
    universalInputEnabled() &&
    !props.items &&
    !props.disableDefaultAction &&
    !CommandState.isInCommandScope() &&
    !CommandState.isEntityActionMode();
  const promote = () => {
    if (
      !disposed &&
      ready &&
      !typing &&
      !composing &&
      input?.isConnected &&
      eligible() &&
      shouldUseUniversalInput(input.value, expanded())
    )
      setExpanded(true);
  };
  const prepareComposer = async () => {
    try {
      loading ??= CommandUniversalInput.preload();
      await loading;
      ready = true;
      promote();
    } catch {
      loading = undefined;
    }
  };
  const updateQuery = (element: HTMLTextAreaElement, isComposing: boolean) => {
    input = element;
    composing = isComposing;
    selection = {
      start: element.selectionStart ?? element.value.length,
      end: element.selectionEnd ?? element.value.length,
    };
    CommandState.setQuery(element.value);
    if (
      !composing &&
      eligible() &&
      shouldUseUniversalInput(element.value, expanded())
    ) {
      if (ready) promote();
      else fireAndForget(prepareComposer(), 'command-menu');
    }
  };
  createEffect(
    on(CommandState.isOpen, (open) => {
      if (!open) setExpanded(false);
    })
  );
  onMount(() => {
    if (eligible()) fireAndForget(prepareComposer(), 'command-menu');
  });
  onCleanup(() => {
    disposed = true;
  });
  const finish = () => {
    props.onHint?.();
    CommandState.close();
  };
  const searchMenu = () => (
    <CommandSearchMenu
      {...props}
      onQueryInput={updateQuery}
      onQueryKeyDown={() => {
        typing = true;
      }}
      onQueryKeyUp={(element, isComposing) => {
        typing = false;
        updateQuery(element, isComposing);
      }}
    />
  );
  return (
    <div class="contents" data-command-menu>
      <Show when={expanded() && eligible()} fallback={searchMenu()}>
        <CommandComposerMenu {...props}>
          <Suspense
            fallback={<p class="text-sm text-ink-muted">Opening composer…</p>}
          >
            <CommandUniversalInput
              text={CommandState.query()}
              selection={selection}
              layout={CommandComposerLayout}
              onTextChange={(text) => {
                CommandState.setQuery(text.trim() ? text : '');
                if (!text.trim()) setExpanded(false);
              }}
              onComplete={finish}
              onNavigate={finish}
            />
          </Suspense>
        </CommandComposerMenu>
      </Show>
    </div>
  );
}

function CommandComposerMenu(
  props: CommandMenuInnerProps & { children: JSX.Element }
) {
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('command-composer');
  registerHotkey({
    scopeId,
    hotkey: 'escape',
    description: 'Close command menu',
    runWithInputFocused: true,
    hide: true,
    keyDownHandler: (event) => {
      if (event?.isComposing) return false;
      CommandState.close();
      return true;
    },
  });
  return (
    <CommandMenuShell
      ref={attachHotkeys}
      depth={props.depth}
      class={props.class}
    >
      {props.children}
    </CommandMenuShell>
  );
}

function CommandMenuLogo() {
  const [multiline, setMultiline] = createSignal(false);
  let logo: HTMLSpanElement | undefined;
  onMount(() => {
    const icon = logo;
    const header = icon?.parentElement;
    const input = header?.querySelector<HTMLElement>(
      '[data-universal-input], textarea'
    );
    if (!input || !icon || !header) return;
    const measure = () => {
      // Measure at the width of the single-line layout even while the logo is
      // hidden, so revealing it cannot wrap the text and toggle it off again.
      const maxWidth = input.style.maxWidth;
      if (multiline()) {
        const gap = Number.parseFloat(getComputedStyle(header).columnGap);
        const logoWidth = Number.parseFloat(getComputedStyle(icon).width);
        input.style.maxWidth = `${input.getBoundingClientRect().width - logoWidth - gap}px`;
      }
      const style = getComputedStyle(input.firstElementChild ?? input);
      const lineHeight =
        Number.parseFloat(style.lineHeight) ||
        Number.parseFloat(style.fontSize) * 1.5;
      const padding = getComputedStyle(input);
      const textHeight =
        input.scrollHeight -
        Number.parseFloat(padding.paddingTop) -
        Number.parseFloat(padding.paddingBottom);
      const next = input.childElementCount > 1 || textHeight > lineHeight * 1.5;
      input.style.maxWidth = maxWidth;
      setMultiline(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(input);
    input.addEventListener('input', measure);
    measure();
    onCleanup(() => {
      observer.disconnect();
      input.removeEventListener('input', measure);
    });
  });
  return (
    <span
      ref={logo}
      data-testid="command-input-logo"
      aria-hidden="true"
      class="flex size-5 shrink-0 items-center justify-center text-accent"
      classList={{ hidden: multiline() }}
    >
      <Macro class="size-3" />
    </span>
  );
}

function CommandComposerLayout(props: InputLayoutParts) {
  return (
    <>
      <CommandMenuShell.Header>
        <CommandMenuLogo />
        {props.editor}
      </CommandMenuShell.Header>
      <CommandMenuShell.Body class="space-y-3 p-4" scroll>
        {props.fields}
        {props.result}
      </CommandMenuShell.Body>
    </>
  );
}

function CommandSearchMenu(
  props: CommandMenuInnerProps & {
    onQueryInput: (input: HTMLTextAreaElement, composing: boolean) => void;
    onQueryKeyDown: () => void;
    onQueryKeyUp: (input: HTMLTextAreaElement, composing: boolean) => void;
  }
) {
  const [commandMenuRef, setCommandMenuRef] = createSignal<HTMLDivElement>();
  let searchInput: HTMLTextAreaElement | undefined;

  const analytics = useAnalytics();
  const projectsFlag = useFeatureFlag(enableProjects);
  const categories = () =>
    CATEGORIES.filter(
      (item) => item.id !== 'projects' || projectsFlag().enabled
    );
  const categoryFilter = () =>
    CommandState.categoryFilter() === 'projects' && !projectsFlag().enabled
      ? 'all'
      : CommandState.categoryFilter();

  const { popoverSplit } = useSplitLayout();

  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('command-menu');

  const query = debouncedDependent(CommandState.query, 60);

  useDatabaseDiscoverySync(() => !props.items && CommandState.isOpen());

  const defaultCommandItems = props.items
    ? undefined
    : useCommandItems(query, categoryFilter, {
        searchActive: CommandState.isOpen,
        contactDiscovery: useCrmContactDiscovery,
      });
  const filteredItems = props.items ?? defaultCommandItems!.items;
  const pagination = defaultCommandItems?.pagination;
  const isLoadingEntities = () =>
    defaultCommandItems?.isLoadingEntities() ?? false;
  const listController = createCommandListController({
    items: filteredItems,
    selectedIndex: CommandState.selectedIndex,
    setSelectedIndex: CommandState.setSelectedIndex,
  });

  createEffect(() => {
    const items = filteredItems();
    const current = CommandState.selectedIndex();
    if (current >= items.length && items.length > 0) {
      listController.setSelectedIndex(items.length - 1);
    }
  });

  // Skip past the search row only onto a real result — when the query has
  // no results the rows below are fallbacks (ask AI), and the search row
  // should stay the default.
  const resultFollowsSearchRow = () =>
    defaultCommandResultIndex(filteredItems()) === 1;
  createEffect(
    on([query, categoryFilter], () => {
      listController.setSelectedIndex(resultFollowsSearchRow() ? 1 : 0);
    })
  );
  // Results fetched from the server (CRM contacts outside the cache, projects)
  // can appear after the query changes; the first one takes the default
  // selection the search row held until then.
  createEffect(
    on(
      resultFollowsSearchRow,
      (hasResult, hadResult) => {
        if (hasResult && !hadResult && CommandState.selectedIndex() === 0) {
          listController.setSelectedIndex(1);
        }
      },
      { defer: true }
    )
  );

  const selectedItem = () => {
    const items = filteredItems();
    const index = CommandState.selectedIndex();
    return items[index];
  };

  // Fire command highlight hooks (e.g. live theme preview) as the selection
  // moves via hover or arrow keys. The outgoing command's onHighlightEnd runs
  // before the incoming command's onHighlight; unmount (menu close) ends any
  // active highlight.
  let highlightedCommand: HotkeyCommand | undefined;
  const setHighlightedCommand = (command: HotkeyCommand | undefined) => {
    if (command === highlightedCommand) return;
    highlightedCommand?.onHighlightEnd?.();
    highlightedCommand = command;
    command?.onHighlight?.();
  };
  createEffect(() => {
    const item = selectedItem();
    setHighlightedCommand(item && isCommandItem(item) ? item.data : undefined);
  });
  onCleanup(() => setHighlightedCommand(undefined));

  const selectedIsCommand = () => {
    const item = selectedItem();
    return item && isCommandItem(item);
  };
  const selectedIsEntity = () => {
    const item = selectedItem();
    return item && (isEntityItem(item) || isUserItem(item));
  };
  const selectedIsSearch = () => {
    const item = selectedItem();
    return item && isSearchItem(item);
  };
  const selectedIsAskAi = () => {
    const item = selectedItem();
    return item && isAskAiItem(item);
  };

  const openResult = createCommandResultOpener();

  function handleItemAction(item: CommandMenuItem, openInNewSplit = false) {
    if (!item) return;
    if (
      (item.kind === 'new-project' ||
        (isEntityItem(item) && item.bucket === 'initiative')) &&
      !projectsFlag().enabled
    )
      return;

    props.onSelect?.(item);
    if (props.disableDefaultAction) {
      // Close like a normal selection, just without navigating/running.
      CommandState.close();
      CommandState.setQuery('');
      return;
    }
    analytics.track('command_menu_use', { itemType: item.bucket });

    if (isCommandItem(item)) {
      const command = item.data;
      trackCommandUsage(item.id);

      // Create opens its own launcher; other multi-stage commands stay here.
      if (
        command.activateCommandScopeId &&
        command.hotkeyToken !== TOKENS.global.createCommand
      ) {
        const commandScope = hotkeyScopeTree.get(
          command.activateCommandScopeId
        );
        if (commandScope) {
          commandScope.parentScopeId = hotkeyScope;
          setPressedKeys(new Set<string>());
          setActiveScope(commandScope.scopeId);
        }

        // Get commands from the nested scope
        const nestedCommands = getActiveCommandsFromScope(
          command.activateCommandScopeId,
          {
            sortByScopeLevel: false,
            hideShadowedCommands: false,
            hideCommandsWithoutHotkeys: false,
            limitToCurrentScope: true,
          }
        );
        CommandState.setQuery('');
        CommandState.setCommandScopeCommands(nestedCommands);
        CommandState.activateCommandScopePlaceholder(
          command.activateCommandScopeId
        );
        CommandState.setSelectedIndex(0);
        return;
      }

      // Regular command - close and run
      if (CommandState.commandScopeCommands().length > 0) {
        setActiveScope(hotkeyScope);
      }
      CommandState.close();
      CommandState.setQuery('');
      runCommand(command);
      return;
    }

    if (item.kind === 'new-project') {
      CommandState.close();
      CommandState.setQuery('');
      popoverSplit({ type: 'component', id: 'project-compose' });
      return;
    }

    if (openResult(item, openInNewSplit)) {
      CommandState.close();
      CommandState.setQuery('');
      return;
    }

    CommandState.close();
    CommandState.setQuery('');
  }

  const navDownHotkey = registerHotkey({
    hotkey: ['arrowdown', 'ctrl+j'],
    scopeId: hotkeyScope,
    description: () => t('commandMenu.moveSelectionDown'),
    keyDownHandler: () => {
      const items = filteredItems();
      if (items.length === 0) return false;
      if (
        CommandState.selectedIndex() >= items.length - 1 &&
        (pagination?.hasMore() || pagination?.isLoadingMore())
      ) {
        if (!pagination?.isLoadingMore())
          fireAndForget(pagination?.loadMore(), 'command-menu');
        return true;
      }
      return listController.selectNext();
    },
    runWithInputFocused: true,
    hide: true,
  });

  const navUpHotkey = registerHotkey({
    hotkey: ['arrowup', 'ctrl+k'],
    scopeId: hotkeyScope,
    description: () => t('commandMenu.moveSelectionUp'),
    keyDownHandler: () => {
      const items = filteredItems();
      if (items.length === 0) return false;
      return listController.selectPrevious();
    },
    runWithInputFocused: true,
    hide: true,
  });

  const confirmHotkey = registerHotkey({
    hotkey: 'enter',
    scopeId: hotkeyScope,
    description: () => t('commandMenu.selectItem'),
    keyDownHandler: (event) => {
      if (event?.isComposing || event?.shiftKey) return false;
      const item = selectedItem();
      if (item) {
        handleItemAction(item, false);
        return true;
      }
      return false;
    },
    runWithInputFocused: true,
  });

  const escapeHotkey = registerHotkey({
    hotkey: 'escape',
    scopeId: hotkeyScope,
    description: () => t('commandMenu.closeCommandMenu'),
    keyDownHandler: () => {
      // If in command scope, go back to main menu
      if (CommandState.commandScopeCommands().length > 0) {
        CommandState.clearCommandScopeCommands();
        CommandState.setSelectedIndex(0);
        setActiveScope(hotkeyScope);
        return true;
      }
      // Entity action mode and normal mode both close the menu
      CommandState.close();
      return true;
    },
    runWithInputFocused: true,
    hide: true,
  });

  // Backspace when query is empty goes back from command scope
  const backspaceHotkey = registerHotkey({
    hotkey: 'backspace',
    scopeId: hotkeyScope,
    description: () => t('commandMenu.goBack'),
    keyDownHandler: () => {
      // Only handle if query is empty
      if (CommandState.query() !== '') {
        return false;
      }
      // If in command scope, go back
      if (CommandState.commandScopeCommands().length > 0) {
        CommandState.clearCommandScopeCommands();
        CommandState.setSelectedIndex(0);
        setActiveScope(hotkeyScope);
        return true;
      }
      // Entity action mode doesn't have "back" - just close with escape
      return false;
    },
    runWithInputFocused: true,
    hide: true,
  });

  const tabHotkey = registerHotkey({
    hotkey: 'tab',
    scopeId: hotkeyScope,
    description: () => t('commandMenu.nextCategory'),
    keyDownHandler: () => {
      const currentIndex = categories().findIndex(
        (c) => c.id === categoryFilter()
      );
      const nextIndex = (currentIndex + 1) % categories().length;
      CommandState.setCategoryFilter(categories()[nextIndex].id);
      return true;
    },
    runWithInputFocused: true,
    hide: true,
  });

  registerHotkey({
    hotkey: 'shift+tab',
    scopeId: hotkeyScope,
    description: () => t('commandMenu.previousCategory'),
    keyDownHandler: () => {
      const currentIndex = categories().findIndex(
        (c) => c.id === categoryFilter()
      );
      const prevIndex =
        (currentIndex - 1 + categories().length) % categories().length;
      CommandState.setCategoryFilter(categories()[prevIndex].id);
      return true;
    },
    runWithInputFocused: true,
    hide: true,
  });

  onMount(() => {
    const element = commandMenuRef();
    if (element) {
      attachHotkeys(element);
    }
    // Returning from the composer mounts a new input in an already-open dialog.
    searchInput?.focus();
  });

  const runHint = () => {
    const hint = CommandState.hint();
    if (!hint) return;
    props.onHint?.();
    CommandState.close();
    // After the dialog has gone, so its focus trap lets the hint move focus.
    setTimeout(hint.run);
  };
  // The hint's own key (e.g. ⌘P) works while the menu is open.
  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!CommandState.hint()?.matches(e)) return;
      e.preventDefault();
      e.stopPropagation();
      runHint();
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  const isInCommandScope = createMemo(
    () => CommandState.commandScopeCommands().length > 0
  );

  const isEntityActionMode = createMemo(() =>
    CommandState.isEntityActionMode()
  );

  // Back is only available in command scope (entity action mode just closes).
  const handleBack = () => {
    if (!isInCommandScope()) return;
    CommandState.clearCommandScopeCommands();
    CommandState.setSelectedIndex(0);
    // Match the Escape/Backspace handlers: restore the menu's hotkey scope.
    // Clicking the back button doesn't focus it in some browsers, so without
    // this the sub-view's command scope stays active and stray keypresses
    // (e.g. digits) would be routed to it.
    setActiveScope(hotkeyScope);
  };

  const categoryTabs = () =>
    categories().map((c) => ({
      value: c.id,
      label: c.label,
    }));

  return (
    <CommandMenuShell
      class={cn('max-h-[75vh]', props.class)}
      ref={setCommandMenuRef}
      depth={props.depth}
    >
      <CommandMenuShell.Header>
        <Show when={isInCommandScope()} fallback={<CommandMenuLogo />}>
          <button
            class="flex size-5 shrink-0 items-center justify-center text-ink-muted hover:text-ink transition-colors"
            onClick={handleBack}
            title={t('commandMenu.backWithEsc')}
          >
            <ArrowLeft class="size-3" />
          </button>
        </Show>
        <CommandMenuSearchInput
          ref={(element) => {
            searchInput = element;
          }}
          as="textarea"
          placeholder={
            CommandState.commandScopePlaceholder() ??
            (isEntityActionMode()
              ? t('commandMenu.searchActionsPlaceholder')
              : t('commandMenu.searchPlaceholder'))
          }
          value={CommandState.query()}
          onInput={(e) => props.onQueryInput(e.currentTarget, e.isComposing)}
          onCompositionEnd={(e) => props.onQueryInput(e.currentTarget, false)}
          onKeyDown={props.onQueryKeyDown}
          onKeyUp={(e) => props.onQueryKeyUp(e.currentTarget, e.isComposing)}
          autofocus
        />
      </CommandMenuShell.Header>

      <Show
        when={
          !isInCommandScope() && !isEntityActionMode() && CommandState.hint()
        }
      >
        {(hint) => (
          <button
            type="button"
            class="mx-2 mt-2 flex items-center justify-between gap-2 rounded-md border border-edge-muted bg-inset px-2.5 py-1.5 text-left text-ink-muted text-xs hover:bg-hover hover:text-ink"
            data-testid="command-menu-hint"
            onClick={runHint}
          >
            <span class="truncate">{hint().message}</span>
            <kbd class="shrink-0 rounded border border-edge-muted px-1 font-sans text-ink">
              {hint().shortcut}
            </kbd>
          </button>
        )}
      </Show>

      <Show when={isEntityActionMode() || !isInCommandScope()}>
        <CommandMenuShell.Toolbar
          class={cn(
            'pl-2.5 pr-1.5 pt-2 border-0 bg-transparent',
            isEntityActionMode() && 'gap-1.5'
          )}
        >
          <Show
            when={isEntityActionMode()}
            fallback={
              <Tabs
                aria-label="Result categories"
                size="sm"
                options={categoryTabs()}
                value={categoryFilter()}
                onChange={CommandState.setCategoryFilter}
              />
            }
          >
            <EntityActionPreview
              entities={CommandState.entityActionEntities()}
            />
          </Show>
        </CommandMenuShell.Toolbar>
      </Show>

      <CommandMenuShell.Body>
        <CommandResults
          items={filteredItems()}
          selectedIndex={CommandState.selectedIndex()}
          onSelect={handleItemAction}
          onItemMouseMove={listController.setSelectedIndexFromPointer}
          scrollSelectedIntoView={listController.shouldScrollSelectedIntoView()}
          pagination={pagination}
          loading={isLoadingEntities()}
        />
      </CommandMenuShell.Body>

      <CommandMenuShell.Footer class="bg-transparent">
        <span class="flex items-center gap-1">
          <div class="flex gap-1">
            <div class="flex border border-edge-muted text-xxs rounded-md items-center px-1.5 py-px font-normal">
              <Hotkey shortcut={navUpHotkey.hotkey()} class="space-x-1" />
            </div>
            <div class="flex border border-edge-muted text-xxs rounded-md items-center px-1.5 py-px font-normal">
              <Hotkey shortcut={navDownHotkey.hotkey()} class="space-x-1" />
            </div>
          </div>
          {t('commandMenu.navigate')}
        </span>

        <Switch>
          <Match when={isInCommandScope()}>
            <HotkeyHint
              command={confirmHotkey}
              label={t('commandMenu.hintRunAction')}
            />
            <HotkeyHint
              command={backspaceHotkey}
              label={t('commandMenu.hintBack')}
            />
          </Match>
          <Match when={selectedIsCommand() || isEntityActionMode()}>
            <HotkeyHint
              command={confirmHotkey}
              label={t('commandMenu.hintRunAction')}
            />
          </Match>
          <Match when={selectedIsSearch()}>
            <HotkeyHint
              command={confirmHotkey}
              label={t('commandMenu.hintSearch')}
            />
          </Match>
          <Match when={selectedIsAskAi()}>
            <HotkeyHint
              command={confirmHotkey}
              label={t('commandMenu.hintAskAi')}
            />
          </Match>
          <Match when={selectedIsEntity()}>
            <HotkeyHint
              command={confirmHotkey}
              label={t('commandMenu.hintOpen')}
            />
          </Match>
        </Switch>

        <Show when={!isInCommandScope() && !isEntityActionMode()}>
          <HotkeyHint
            command={tabHotkey}
            label={t('commandMenu.hintCategory')}
          />
        </Show>
        <Show
          when={isInCommandScope()}
          fallback={
            <HotkeyHint
              command={escapeHotkey}
              label={t('commandMenu.hintClose')}
            />
          }
        >
          <HotkeyHint
            command={escapeHotkey}
            label={t('commandMenu.hintBack')}
          />
        </Show>
      </CommandMenuShell.Footer>
    </CommandMenuShell>
  );
}

/** Preview row showing entities being acted upon in entity action mode */
function EntityActionPreview(props: { entities: EntityData[] }) {
  const displayEntities = () => props.entities.slice(0, 2);
  const remainingCount = () => Math.max(0, props.entities.length - 2);

  return (
    <>
      <For each={displayEntities()}>
        {(entity) => <EntitySelectionBadge entity={entity} />}
      </For>
      <Show when={remainingCount() > 0}>
        <Badge size="sm">
          {t('commandMenu.moreCount', { count: remainingCount() })}
        </Badge>
      </Show>
    </>
  );
}

function HotkeyHint(props: { command: RegisterHotkeyReturn; label: string }) {
  return (
    <CommandMenuHotkeyHint
      hotkey={<Hotkey shortcut={props.command.hotkey()} class="space-x-1" />}
      label={props.label}
    />
  );
}
