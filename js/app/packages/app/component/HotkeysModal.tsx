import { BasicHotkey } from '@core/component/Hotkey';
import { Modal, Content, Header, Overlay } from '@core/component/Modal';
import { getActiveCommandsFromScope } from '@core/hotkey/getCommands';
import { prettyPrintHotkeyString } from '@core/hotkey/utils';
import { createMemo, For, Show } from 'solid-js';

interface HotkeysModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type GroupedCommand = {
  category: string;
  commands: Array<{
    description: string;
    hotkeys: string[];
  }>;
};

export function HotkeysModal(props: HotkeysModalProps) {
  const allCommands = createMemo(() => {
    // Get all commands from the global scope, including all child scopes
    // We want to show all commands, not just the ones that are currently active
    // So we'll traverse the entire scope tree
    return getActiveCommandsFromScope('global', {
      hideCommandsWithoutHotkeys: true,
      hideShadowedCommands: false,
      sortByScopeLevel: false,
    });
  });

  const groupedCommands = createMemo(() => {
    const commands = allCommands();
    const groups = new Map<string, GroupedCommand['commands']>();
    const seenHotkeys = new Set<string>();

    commands.forEach((command) => {
      const description =
        typeof command.description === 'function'
          ? command.description()
          : command.description;

      const hotkeys = (command.hotkeys ?? [])
        .map((hk) => prettyPrintHotkeyString(hk))
        .filter((hk): hk is string => hk !== undefined);

      if (hotkeys.length === 0) return;

      // Skip if we've already seen this exact hotkey combination
      const hotkeyKey = hotkeys.sort().join(',');
      if (seenHotkeys.has(hotkeyKey)) return;
      seenHotkeys.add(hotkeyKey);

      // Use tags for grouping if available, otherwise use "General"
      const category = command.tags && command.tags.length > 0
        ? command.tags[0]
        : 'General';

      if (!groups.has(category)) {
        groups.set(category, []);
      }

      groups.get(category)!.push({
        description,
        hotkeys,
      });
    });

    // Convert to array and sort categories
    const sortedCategories = Array.from(groups.entries())
      .map(([category, commands]) => ({
        category,
        commands: commands.sort((a, b) =>
          a.description.localeCompare(b.description)
        ),
      }))
      .sort((a, b) => {
        // Put "General" at the end
        if (a.category === 'General') return 1;
        if (b.category === 'General') return -1;
        return a.category.localeCompare(b.category);
      });

    return sortedCategories;
  });

  return (
    <Modal open={props.open} onOpenChange={props.onOpenChange}>
      <Overlay />
      <Content class="max-w-4xl max-h-[85vh] overflow-y-auto">
        <div class="flex flex-col gap-6 w-full p-1">
          <div class="flex items-center justify-between">
            <Header>Keyboard Shortcuts</Header>
            <BasicHotkey shortcut="shift+cmd+/" theme="base" />
          </div>

          <div class="flex flex-col gap-6">
            <For each={groupedCommands()}>
              {(group) => (
                <div class="flex flex-col gap-3">
                  <h3 class="text-ink text-sm font-semibold uppercase tracking-wide border-b border-edge pb-1">
                    {group.category}
                  </h3>
                  <div class="grid grid-cols-1 gap-1.5">
                    <For each={group.commands}>
                      {(command) => (
                        <div class="flex items-center justify-between py-2 px-3 rounded hover:bg-menu/50 transition-colors">
                          <span class="text-ink text-sm">{command.description}</span>
                          <div class="flex items-center gap-2">
                            <For each={command.hotkeys}>
                              {(hotkey) => (
                                <BasicHotkey shortcut={hotkey} theme="base" />
                              )}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>

          <Show when={groupedCommands().length === 0}>
            <div class="text-ink-muted text-sm text-center py-8">
              No keyboard shortcuts available
            </div>
          </Show>
        </div>
      </Content>
    </Modal>
  );
}
