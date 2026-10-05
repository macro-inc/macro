import ArrowDown from '@phosphor/arrow-down.svg';
import ArrowUp from '@phosphor/arrow-up.svg';
import Copy from '@phosphor/copy.svg';
import DotsThree from '@phosphor/dots-three.svg';
import Rows from '@phosphor/rows.svg';
import Trash from '@phosphor/trash.svg';
import Warning from '@phosphor/warning.svg';
import { Button, Dropdown, ToggleSwitch } from '@ui';
import { For } from 'solid-js';

/**
 * A selected question's actions. Removing takes it off the form and keeps the
 * column; deleting the column (and its answers) is a separate, confirmed item.
 */
export function QuestionFooter(props: {
  required: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  sections: readonly { id: string; name: string; current: boolean }[];
  onRequired: (required: boolean) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveToSection: (sectionId: string) => void;
  onDeleteColumn: () => void;
}) {
  return (
    <div class="mt-1 flex items-center justify-end gap-1 border-t border-edge-divider pt-2">
      <Button
        variant="ghost"
        size="icon-sm"
        label="Duplicate question"
        onClick={props.onDuplicate}
      >
        <Copy />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        label="Remove from form (keeps the column)"
        onClick={props.onRemove}
      >
        <Trash />
      </Button>
      <span class="mx-1.5 h-5 w-px bg-edge-divider" aria-hidden="true" />
      <ToggleSwitch
        label="Required"
        labelClass="text-xs text-ink-muted"
        checked={props.required}
        onChange={props.onRequired}
      />
      <Dropdown>
        <Dropdown.Trigger
          variant="ghost"
          size="icon-sm"
          aria-label="More question actions"
        >
          <DotsThree />
        </Dropdown.Trigger>
        <Dropdown.Content class="w-60">
          <Dropdown.Group>
            <Dropdown.Item
              disabled={!props.canMoveUp}
              onSelect={props.onMoveUp}
            >
              <ArrowUp class="size-4" />
              <span class="flex-1">Move up</span>
            </Dropdown.Item>
            <Dropdown.Item
              disabled={!props.canMoveDown}
              onSelect={props.onMoveDown}
            >
              <ArrowDown class="size-4" />
              <span class="flex-1">Move down</span>
            </Dropdown.Item>
            <Dropdown.Sub>
              <Dropdown.SubTrigger
                disabled={props.sections.filter((s) => !s.current).length === 0}
              >
                <Rows class="size-4" />
                <span class="flex-1">Move to section</span>
              </Dropdown.SubTrigger>
              <Dropdown.SubContent>
                <For
                  each={props.sections.filter((section) => !section.current)}
                >
                  {(section) => (
                    <Dropdown.Item
                      onSelect={() => props.onMoveToSection(section.id)}
                    >
                      <span class="flex-1 truncate">{section.name}</span>
                    </Dropdown.Item>
                  )}
                </For>
              </Dropdown.SubContent>
            </Dropdown.Sub>
          </Dropdown.Group>
          <Dropdown.Separator class="my-1 h-px bg-edge-divider" />
          <Dropdown.Group>
            <Dropdown.Item
              class="text-failure-ink"
              onSelect={props.onDeleteColumn}
            >
              <Warning class="size-4" />
              <span class="flex-1">Delete column and answers…</span>
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}
