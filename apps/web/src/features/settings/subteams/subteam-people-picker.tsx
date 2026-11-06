import { SearchBar } from '@app/components/view-shell/SearchBar';
import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, macroIdToEmail, tryMacroId } from '@core/user';
import { fuzzyFilter } from '@core/util/fuzzy';
import { Checkbox } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

function nameOf(userId: string) {
  return getDisplayName(tryMacroId(userId)) || userId;
}

function emailOf(userId: string) {
  const macroId = tryMacroId(userId);
  return macroId ? macroIdToEmail(macroId) : userId;
}

/** Workspace members to pick from, with a filter. */
export function SubteamPeoplePicker(props: {
  userIds: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const [query, setQuery] = createSignal('');
  const visible = createMemo(() => {
    const q = query().trim();
    if (!q) return props.userIds;

    return fuzzyFilter(
      q,
      props.userIds,
      (userId) => `${nameOf(userId)} ${emailOf(userId)}`
    );
  });

  const toggle = (userId: string, checked: boolean) =>
    props.onChange(
      checked
        ? [...props.selected, userId]
        : props.selected.filter((id) => id !== userId)
    );

  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between">
        <span class="text-sm text-ink-muted">
          {t('settingsTeams.peopleLabel')}
        </span>
        <span class="text-xs text-ink-muted">
          {t('settingsTeams.selected', { count: props.selected.length })}
        </span>
      </div>
      <SearchBar
        size="sm"
        label={t('settingsTeams.filterPeople')}
        placeholder={t('settingsTeams.filterPeople')}
        value={query()}
        onValueChange={setQuery}
        onEscape={() => setQuery('')}
      />
      <div class="max-h-56 overflow-y-auto rounded-lg border border-edge-muted">
        <For
          each={visible()}
          fallback={
            <div class="px-3 py-3 text-sm text-ink-muted">
              {t('settingsTeams.noPeopleMatch')}
            </div>
          }
        >
          {(userId) => (
            <Checkbox
              class="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-hover"
              checked={props.selected.includes(userId)}
              onChange={(checked) => toggle(userId, checked)}
            >
              <UserIcon id={userId} isDeleted={false} size="md" />
              <Checkbox.Label class="min-w-0 flex-1 truncate text-sm text-ink">
                {nameOf(userId)}
                <Show when={nameOf(userId) !== emailOf(userId)}>
                  <span class="ml-2 text-xs text-ink-muted">
                    {emailOf(userId)}
                  </span>
                </Show>
              </Checkbox.Label>
              <Checkbox.Control />
            </Checkbox>
          )}
        </For>
      </div>
    </div>
  );
}
