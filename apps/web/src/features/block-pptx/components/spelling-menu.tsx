/**
 * The top of the right-click menu on a misspelled word: suggestions, then
 * Ignore All and Add to Dictionary, as in PowerPoint.
 */

import { MenuItem, MenuSeparator } from '@core/component/ContextMenu';
import { For, Show } from 'solid-js';

/** A misspelled word right-clicked, and what can be done with it. */
export interface SpellingMenu {
  word: string;
  suggestions: string[];
  readonly: boolean;
  replace: (suggestion: string) => void;
  ignoreAll: () => void;
  addToDictionary: () => void;
}

export function SpellingMenuItems(props: { menu: SpellingMenu }) {
  const m = () => props.menu;
  return (
    <>
      <For
        each={m().suggestions}
        fallback={<MenuItem text="(No Spelling Suggestions)" disabled />}
      >
        {(s) => (
          <MenuItem
            text={
              <span
                class="font-semibold"
                data-testid="pptx-spelling-menu-suggestion"
              >
                {s}
              </span>
            }
            disabled={m().readonly}
            onClick={() => m().replace(s)}
          />
        )}
      </For>
      <MenuItem
        text={
          <span data-testid="pptx-spelling-menu-ignore-all">Ignore All</span>
        }
        onClick={() => m().ignoreAll()}
      />
      <Show when={!m().readonly}>
        <MenuItem
          text={
            <span data-testid="pptx-spelling-menu-add">Add to Dictionary</span>
          }
          onClick={() => m().addToDictionary()}
        />
      </Show>
      <MenuSeparator />
    </>
  );
}
