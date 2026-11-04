import { activeElement } from '@app/signal/focus';
import { isEditableInput } from '@core/util/isEditableInput';
import { createMemo } from 'solid-js';
import { activeScope, hotkeyScopeTree } from './state';
import type { HotkeyCommand, ValidHotkey } from './types';
import { compareCommandPrecedence, getCommandsForHotkey } from './utils';

type sortAndFilterOptions = {
  // orders commands from the active scope to the global scope, sub-ordered by displayPriority
  sortByScopeLevel?: boolean;
  // hides commands that are shadowed by another command in a more specific scope
  hideShadowedCommands?: boolean;
  // shows commands that don't have hotkeys
  hideCommandsWithoutHotkeys?: boolean;
  // shows only commands from the specified scope, not from all scopes
  limitToCurrentScope?: boolean;
  // skips the runWithInputFocused filter — use for the command menu where all commands should be shown regardless of input focus
  ignoreInputFocused?: boolean;
  // keeps commands registered with `hide` — the shortcut sheet lists hidden navigation keys
  includeHidden?: boolean;
};

// This is reactive on active scope (if scope not specified), activeElement, and commmand conditions.
function _useActiveCommands(
  displayOptions?: sortAndFilterOptions,
  scope?: string
) {
  return createMemo(() => {
    const scopeId = scope ?? activeScope() ?? '';
    return getActiveCommandsFromScope(scopeId, displayOptions ?? {});
  });
}

export type CommandWithInfo = HotkeyCommand & {
  // the current active scope is 0, the parent scope is 1, etc.
  scopeLevel: number;
  // true if the command's hotkey is shadowed by another command in a lower scope level
  hotkeyIsShadowed: boolean;
};

// You can use this non-reatively to "print" the commands for a given scope with current conditions
export function getActiveCommandsFromScope(
  scopeId: string,
  displayOptions: sortAndFilterOptions = {}
) {
  let currentScopeNode = hotkeyScopeTree.get(scopeId);
  const hotkeySet: Set<ValidHotkey> = new Set();
  const commands: CommandWithInfo[] = [];
  let scopeLevel = 0;
  while (currentScopeNode) {
    const scopeNode = currentScopeNode;
    // A command is enumerable when it is unkeyed (command-palette only) or
    // currently effective on at least one of its keys. Eclipsed commands —
    // older registrations an 'override' displaced — are omitted; they aren't
    // runnable until the override is disposed. Within the scope, a key
    // belongs to the command that would run first for it.
    const scopeCommands = scopeNode.commands
      .filter(
        (command) =>
          !command.hotkeys ||
          command.hotkeys.some((hk) =>
            getCommandsForHotkey(scopeNode, hk).includes(command)
          )
      )
      .filter(filterCommands(displayOptions))
      .sort(compareCommandPrecedence)
      .map((command) => {
        const hotkeys = command.hotkeys ?? [];
        const isShadowed = hotkeys.some((hk) => hotkeySet.has(hk));
        hotkeys.forEach((hk) => hotkeySet.add(hk));
        return { ...command, scopeLevel, hotkeyIsShadowed: isShadowed };
      });
    commands.push(...scopeCommands);
    if (displayOptions.limitToCurrentScope) {
      break;
    }
    currentScopeNode = hotkeyScopeTree.get(
      currentScopeNode?.parentScopeId ?? ''
    );
    scopeLevel++;
  }
  commands.sort((a, b) => {
    if (displayOptions.sortByScopeLevel) {
      if (a.scopeLevel !== b.scopeLevel) {
        return a.scopeLevel - b.scopeLevel;
      }
      return (b.displayPriority ?? 0) - (a.displayPriority ?? 0);
    }
    return (b.displayPriority ?? 0) - (a.displayPriority ?? 0);
  });
  return displayOptions.hideShadowedCommands
    ? commands.filter((command) => !command.hotkeyIsShadowed)
    : commands;
}

/** Every key a command registered in this scope would run for right now. */
export function getRunnableHotkeys(scopeId: string): Set<ValidHotkey> {
  return new Set(
    getActiveCommandsFromScope(scopeId, {
      limitToCurrentScope: true,
      hideCommandsWithoutHotkeys: true,
      ignoreInputFocused: true,
      includeHidden: true,
    }).flatMap((command) => command.hotkeys ?? [])
  );
}

const filterCommands = (displayOptions: sortAndFilterOptions) => {
  return (command: HotkeyCommand) => {
    const hideValue =
      typeof command.hide === 'function' ? command.hide() : command.hide;
    return (
      (command.hotkeys || !displayOptions.hideCommandsWithoutHotkeys) &&
      (!command.condition || command.condition()) &&
      (displayOptions.ignoreInputFocused ||
        !isEditableInput(activeElement() as HTMLElement) ||
        command.runWithInputFocused) &&
      (displayOptions.includeHidden || hideValue !== true)
    );
  };
};

/** One action in the shortcut sheet. Each binding is a key sequence. */
export type ShortcutSheetEntry = {
  description: string;
  bindings: ValidHotkey[][];
  /** The profile that registered these keys, or that took them over. */
  profileLabel?: string;
};

export type ShortcutSheet = {
  /** Shortcuts of the focused view and its parents, nearest first. */
  view: ShortcutSheetEntry[];
  /** Shortcuts that work anywhere in the app. */
  app: ShortcutSheetEntry[];
  /** Macro's shortcuts a turned-on hotkey profile took over here. */
  replaced: ShortcutSheetEntry[];
};

/**
 * The command each key runs: the nearest scope's, and within a scope the one
 * that runs first. Shadowing is per key, so a command keeps its other keys
 * when only one of them is claimed nearer.
 */
function getKeyOwners(
  commands: CommandWithInfo[]
): Map<ValidHotkey, HotkeyCommand> {
  const keyOwners = new Map<ValidHotkey, HotkeyCommand>();
  for (const command of [...commands].sort(
    (a, b) => a.scopeLevel - b.scopeLevel || compareCommandPrecedence(a, b)
  )) {
    for (const hotkey of command.hotkeys ?? []) {
      if (!keyOwners.has(hotkey)) keyOwners.set(hotkey, command);
    }
  }
  return keyOwners;
}

/**
 * Every shortcut reachable from a scope, for the shortcut sheet. Unlike the
 * command menu it includes hidden navigation keys (j/k, Enter, Escape) and
 * expands leader keys into sequences (g then e). Conditions are evaluated
 * now, so read it before the sheet takes focus from the view.
 */
export function getShortcutSheet(scopeId: string): ShortcutSheet {
  const sections = {
    view: new Map<string, ShortcutSheetEntry>(),
    app: new Map<string, ShortcutSheetEntry>(),
    replaced: new Map<string, ShortcutSheetEntry>(),
  };
  const addEntry = (
    section: keyof typeof sections,
    command: HotkeyCommand,
    binding: ValidHotkey[],
    profileLabel: string | undefined
  ) => {
    const description =
      typeof command.description === 'function'
        ? command.description()
        : command.description;
    const entry = sections[section].get(description);
    if (entry) entry.bindings.push(binding);
    else
      sections[section].set(description, {
        description,
        bindings: [binding],
        profileLabel,
      });
  };
  // Leader sequences arrive in dispatch order, so the first command for a
  // sequence is the one it runs; the first default after a profile's is the
  // one the profile took over.
  const sequenceOwners = new Map<string, HotkeyCommand>();
  const replacedSequences = new Set<string>();
  const addSequence = (
    section: keyof typeof sections,
    command: HotkeyCommand,
    binding: ValidHotkey[]
  ) => {
    const bindingKey = binding.join(' ');
    const owner = sequenceOwners.get(bindingKey);
    if (!owner) {
      sequenceOwners.set(bindingKey, command);
      addEntry(section, command, binding, command.profile?.label());
      return;
    }
    if (
      owner.profile &&
      !command.profile &&
      !replacedSequences.has(bindingKey)
    ) {
      replacedSequences.add(bindingKey);
      addEntry('replaced', command, binding, owner.profile.label());
    }
  };

  const commands = getActiveCommandsFromScope(scopeId, {
    sortByScopeLevel: true,
    hideCommandsWithoutHotkeys: true,
    ignoreInputFocused: true,
    includeHidden: true,
  });
  const keyOwners = getKeyOwners(commands);
  // What each key would run without the profiles, to name what they replaced.
  const defaultKeyOwners = getKeyOwners(
    commands.filter((command) => !command.profile)
  );
  for (const command of commands) {
    const section = command.scopeId === 'global' ? 'app' : 'view';
    const leaderScope = command.activateCommandScopeId;
    const hidden =
      typeof command.hide === 'function' ? command.hide() : command.hide;
    for (const hotkey of command.hotkeys ?? []) {
      const owner = keyOwners.get(hotkey);
      if (owner !== command) {
        if (owner?.profile && defaultKeyOwners.get(hotkey) === command) {
          addEntry('replaced', command, [hotkey], owner.profile.label());
        }
        continue;
      }
      if (!leaderScope || hidden !== true) {
        addSequence(section, command, [hotkey]);
      }
    }
    if (!leaderScope) continue;
    // In dispatch order, so a letter a view claims shadows the app's.
    const followers = getActiveCommandsFromScope(leaderScope, {
      limitToCurrentScope: true,
      hideCommandsWithoutHotkeys: true,
      ignoreInputFocused: true,
    }).sort(compareCommandPrecedence);
    for (const leader of command.hotkeys ?? []) {
      // A leader whose key something nearer took opens nothing here.
      if (keyOwners.get(leader) !== command) continue;
      for (const follower of followers) {
        for (const hotkey of follower.hotkeys ?? []) {
          addSequence(follower.sheetSection ?? section, follower, [
            leader,
            hotkey,
          ]);
        }
      }
    }
  }
  return {
    view: [...sections.view.values()],
    app: [...sections.app.values()],
    replaced: [...sections.replaced.values()],
  };
}
