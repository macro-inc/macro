import { t } from '@app/lib/i18n';
import FolderIcon from '@icon/system/regular/folder.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Checkbox, Dropdown, Input } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { KIND_LAYOUTS, type PasswordSlot } from '../core/kinds';
import {
  folderPath,
  type PasswordDraft,
  type PasswordFolder,
} from '../core/types';
import { GeneratorMenu } from './generator-menu';

function inputType(slot: PasswordSlot) {
  return match(slot)
    .with('password', () => 'password')
    .with('url', () => 'url')
    .with('username', 'notes', () => 'text')
    .exhaustive();
}

function Field(props: {
  label: string;
  for: string;
  error?: string;
  children: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-1.5">
      <label for={props.for} class="text-xs text-ink-muted">
        {props.label}
      </label>
      {props.children}
      <Show when={props.error}>
        <span class="text-xs text-failure-ink">{props.error}</span>
      </Show>
    </div>
  );
}

/**
 * In-place editor for one draft. Every keystroke goes straight to the draft
 * store, so switching items, kinds, or panes never loses typed values.
 */
export function ItemForm(props: {
  idPrefix: string;
  draft: PasswordDraft;
  totpKey: string;
  hasTotp: boolean;
  validation?: 'name' | 'url' | 'totp';
  folders: PasswordFolder[];
  /** Sharing is chosen when an item is created; Share changes it later. */
  isNew: boolean;
  onChange: (draft: PasswordDraft) => void;
  onTotpKey: (value: string) => void;
}) {
  const layout = () => KIND_LAYOUTS[props.draft.kind];
  const [addingTotp, setAddingTotp] = createSignal(false);
  const id = (name: string) => `${props.idPrefix}-${name}`;
  const slotValue = (slot: PasswordSlot) =>
    slot === 'url' ? props.draft.url : props.draft.values[slot];
  const setSlot = (slot: PasswordSlot, value: string) =>
    slot === 'url'
      ? props.onChange({ ...props.draft, url: value })
      : props.onChange({
          ...props.draft,
          values: { ...props.draft.values, [slot]: value },
        });
  const setField = (
    index: number,
    change: Partial<{ label: string; value: string }>
  ) =>
    props.onChange({
      ...props.draft,
      values: {
        ...props.draft.values,
        fields: props.draft.values.fields.map((field, position) =>
          position === index ? { ...field, ...change } : field
        ),
      },
    });
  const showTotp = () =>
    layout().totp === 'required' ||
    (layout().totp === 'optional' && (addingTotp() || !!props.totpKey));
  const folderLabel = () =>
    props.draft.folderId
      ? folderPath(props.folders, props.draft.folderId).join(' / ') ||
        t('passwords.noFolder')
      : t('passwords.noFolder');
  return (
    <div class="flex flex-col gap-4">
      <Field
        label={t('passwords.name')}
        for={id('name')}
        error={
          props.validation === 'name' ? t('passwords.requiredName') : undefined
        }
      >
        <Input
          id={id('name')}
          value={props.draft.name}
          aria-invalid={props.validation === 'name'}
          autocomplete="off"
          onInput={(event) =>
            props.onChange({ ...props.draft, name: event.currentTarget.value })
          }
        />
      </Field>
      <For each={layout().slots}>
        {(entry) => (
          <Field
            label={t(`passwords.slot_${entry.label}`)}
            for={id(entry.slot)}
            error={
              entry.slot === 'url' && props.validation === 'url'
                ? t('passwords.invalidUrl')
                : undefined
            }
          >
            <Show
              when={entry.slot !== 'notes'}
              fallback={
                <textarea
                  id={id(entry.slot)}
                  rows={entry.label === 'note' ? 8 : 3}
                  class="min-h-20 w-full resize-y rounded-xl border border-edge-muted bg-transparent px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  value={props.draft.values.notes}
                  onInput={(event) =>
                    setSlot('notes', event.currentTarget.value)
                  }
                />
              }
            >
              <div class="flex items-center gap-1">
                <Input
                  id={id(entry.slot)}
                  class="min-w-0 flex-1"
                  type={inputType(entry.slot)}
                  autocomplete={
                    entry.slot === 'password' ? 'new-password' : 'off'
                  }
                  spellcheck={false}
                  aria-invalid={
                    entry.slot === 'url' && props.validation === 'url'
                  }
                  value={slotValue(entry.slot)}
                  onInput={(event) =>
                    setSlot(entry.slot, event.currentTarget.value)
                  }
                />
                <Show when={entry.slot === 'password' && layout().generator}>
                  <GeneratorMenu
                    onUse={(password) => setSlot('password', password)}
                  />
                </Show>
              </div>
            </Show>
          </Field>
        )}
      </For>
      <For each={props.draft.values.fields}>
        {(field, index) => (
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-1">
              <Input
                size="sm"
                variant="bare"
                class="min-w-0 flex-1 px-0 text-xs text-ink-muted"
                aria-label={t('passwords.fieldLabel')}
                placeholder={t('passwords.fieldLabel')}
                value={field.label}
                onInput={(event) =>
                  setField(index(), { label: event.currentTarget.value })
                }
              />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('passwords.removeField')}
                tooltip={t('passwords.removeField')}
                onClick={() =>
                  props.onChange({
                    ...props.draft,
                    values: {
                      ...props.draft.values,
                      fields: props.draft.values.fields.filter(
                        (_, position) => position !== index()
                      ),
                    },
                  })
                }
              >
                <XIcon class="size-3.5" />
              </Button>
            </div>
            <Input
              type="password"
              autocomplete="off"
              aria-label={field.label || t('passwords.fieldValue')}
              value={field.value}
              onInput={(event) =>
                setField(index(), { value: event.currentTarget.value })
              }
            />
          </div>
        )}
      </For>
      <Show when={showTotp() && !props.hasTotp}>
        <Field
          label={t('passwords.totp')}
          for={id('totp')}
          error={
            props.validation === 'totp'
              ? t('passwords.totpRequired')
              : undefined
          }
        >
          <Input
            id={id('totp')}
            type="password"
            autocomplete="off"
            spellcheck={false}
            placeholder={t('passwords.totpSeed')}
            aria-invalid={props.validation === 'totp'}
            value={props.totpKey}
            onInput={(event) => props.onTotpKey(event.currentTarget.value)}
          />
        </Field>
      </Show>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            props.onChange({
              ...props.draft,
              values: {
                ...props.draft.values,
                fields: [
                  ...props.draft.values.fields,
                  { label: '', value: '' },
                ],
              },
            })
          }
        >
          <PlusIcon class="size-4" />
          {t('passwords.addField')}
        </Button>
        <Show
          when={layout().totp === 'optional' && !showTotp() && !props.hasTotp}
        >
          <Button variant="ghost" size="sm" onClick={() => setAddingTotp(true)}>
            <PlusIcon class="size-4" />
            {t('passwords.addTotp')}
          </Button>
        </Show>
      </div>
      <div class="flex flex-wrap items-center gap-3 border-t border-edge-muted pt-4">
        <Dropdown>
          <Dropdown.Trigger variant="secondary" size="sm">
            <FolderIcon class="size-4" />
            <span class="max-w-48 truncate">{folderLabel()}</span>
          </Dropdown.Trigger>
          <Dropdown.Content class="min-w-56 max-w-[calc(100vw-2rem)]">
            <Dropdown.Item
              onSelect={() =>
                props.onChange({ ...props.draft, folderId: null })
              }
            >
              {t('passwords.noFolder')}
            </Dropdown.Item>
            <For each={props.folders}>
              {(folder) => (
                <Dropdown.Item
                  onSelect={() =>
                    props.onChange({ ...props.draft, folderId: folder.id })
                  }
                >
                  <span class="truncate">
                    {folderPath(props.folders, folder.id).join(' / ')}
                  </span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Content>
        </Dropdown>
        <Show when={props.isNew}>
          <Dropdown>
            <Dropdown.Trigger
              variant="secondary"
              size="sm"
              aria-label={t('passwords.whoCanUse')}
            >
              <Show
                when={props.draft.private}
                fallback={<UsersIcon class="size-4" />}
              >
                <LockIcon class="size-4" />
              </Show>
              <span>
                {props.draft.private
                  ? t('passwords.private')
                  : t('passwords.sharedWithTeam')}
              </span>
            </Dropdown.Trigger>
            <Dropdown.Content class="min-w-48 max-w-[calc(100vw-2rem)]">
              <Dropdown.Item
                onSelect={() =>
                  props.onChange({ ...props.draft, private: false })
                }
              >
                <UsersIcon class="size-4 shrink-0" />
                <span>{t('passwords.sharedWithTeam')}</span>
              </Dropdown.Item>
              <Dropdown.Item
                onSelect={() =>
                  props.onChange({ ...props.draft, private: true })
                }
              >
                <LockIcon class="size-4 shrink-0" />
                <span>{t('passwords.private')}</span>
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown>
        </Show>
        <Checkbox
          checked={props.draft.favorite}
          onChange={(favorite) => props.onChange({ ...props.draft, favorite })}
        >
          <Checkbox.Control />
          <Checkbox.Label>{t('passwords.favorite')}</Checkbox.Label>
        </Checkbox>
      </div>
    </div>
  );
}
