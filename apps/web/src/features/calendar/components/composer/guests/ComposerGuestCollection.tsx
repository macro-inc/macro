import { t } from '@app/lib/i18n';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { type Accessor, For, Show } from 'solid-js';
import { composerGuestName } from '../../../core/composer-guests';
import { createComposerGuestAdditions } from '../../../primitives/create-composer-guest-additions';
import type {
  EventEditorGuestOption,
  SelectedEventEditorGuest,
} from '../event-form-model';
import { ComposerGuestChip } from './ComposerGuestChip';
import { ComposerGuestPicker } from './ComposerGuestPicker';

export interface ComposerGuestCollectionProps {
  options: Accessor<EventEditorGuestOption[]>;
  current: SelectedEventEditorGuest[];
  added: SelectedEventEditorGuest[];
  onAddedChange: (added: SelectedEventEditorGuest[]) => void;
  onClose: () => void;
  disabled?: boolean;
}

export function ComposerGuestCollection(props: ComposerGuestCollectionProps) {
  const additions = createComposerGuestAdditions({
    current: () => props.current,
    added: () => props.added,
    disabled: () => props.disabled ?? false,
    onChange: (added) => props.onAddedChange(added),
  });
  return (
    <div class="flex min-h-0 flex-col gap-2">
      <ComposerGuestPicker
        options={props.options}
        selected={[]}
        excluded={additions.excluded()}
        onChange={additions.add}
        onClose={props.onClose}
      />
      <Show when={props.added.length > 0}>
        <div
          role="list"
          aria-label={t('calendar.newGuests')}
          class="flex flex-wrap gap-1.5 p-2"
        >
          <For each={props.added}>
            {(guest) => (
              <div role="listitem">
                <ComposerGuestChip guest={guest}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    class="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/guest:opacity-100 group-focus-within/guest:opacity-100 focus-visible:opacity-100"
                    aria-label={t('calendar.removeGuest', {
                      name: composerGuestName(guest),
                    })}
                    disabled={props.disabled || !additions.canRemove(guest)}
                    onClick={() => additions.remove(guest)}
                  >
                    <CloseIcon class="size-3" />
                  </Button>
                </ComposerGuestChip>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.current.length > 0}>
        <div class="px-2 text-xs text-ink-muted">
          {t('calendar.invitedGuests')}
        </div>
        <div
          role="list"
          aria-label={t('calendar.invitedGuests')}
          class="flex flex-wrap gap-1.5 p-2"
        >
          <For each={props.current}>
            {(guest) => (
              <div role="listitem">
                <ComposerGuestChip guest={guest} />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
