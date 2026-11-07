import { t } from '@app/lib/i18n';
import { Button, Checkbox, Dropdown, Input } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  generatePassword,
  type PasswordDraft,
  type PasswordFolder,
} from '../core/types';

export function CredentialEditor(props: {
  draft: PasswordDraft;
  folders: PasswordFolder[];
  validation: 'name' | 'url' | undefined;
  onChange: (draft: PasswordDraft) => void;
}) {
  const [length, setLength] = createSignal(24);
  const [generated, setGenerated] = createSignal(generatePassword(24));
  const changeValue = (key: 'username' | 'password' | 'notes', value: string) =>
    props.onChange({
      ...props.draft,
      values: { ...props.draft.values, [key]: value },
    });
  return (
    <div class="flex flex-col gap-5">
      <label class="flex flex-col gap-2 text-xs text-ink-muted">
        {t('passwords.name')}
        <Input
          value={props.draft.name}
          aria-invalid={props.validation === 'name'}
          onInput={(event) =>
            props.onChange({ ...props.draft, name: event.currentTarget.value })
          }
        />
        <Show when={props.validation === 'name'}>
          <span class="text-failure">{t('passwords.requiredName')}</span>
        </Show>
      </label>
      <Dropdown>
        <Dropdown.Trigger>
          {t(`passwords.${props.draft.kind}`)}
        </Dropdown.Trigger>
        <Dropdown.Content>
          <For each={['login', 'card', 'note', 'identity', 'api'] as const}>
            {(kind) => (
              <Dropdown.Item
                onSelect={() => props.onChange({ ...props.draft, kind })}
              >
                {t(`passwords.${kind}`)}
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Content>
      </Dropdown>
      <label class="flex flex-col gap-2 text-xs text-ink-muted">
        {t('passwords.username')}
        <Input
          autocomplete="off"
          value={props.draft.values.username}
          onInput={(event) =>
            changeValue('username', event.currentTarget.value)
          }
        />
      </label>
      <label class="flex flex-col gap-2 text-xs text-ink-muted">
        {t('passwords.password')}
        <Input
          type="password"
          autocomplete="new-password"
          value={props.draft.values.password}
          onInput={(event) =>
            changeValue('password', event.currentTarget.value)
          }
        />
      </label>
      <Dropdown>
        <Dropdown.Trigger>{t('passwords.generator')}</Dropdown.Trigger>
        <Dropdown.Content>
          <div class="flex min-w-64 max-w-[80vw] flex-col gap-3 p-3">
            <label>
              {t('passwords.length')}
              <Input
                type="number"
                min="12"
                max="128"
                value={length()}
                onInput={(event) =>
                  setLength(event.currentTarget.valueAsNumber)
                }
              />
            </label>
            <output class="break-all font-mono">{generated()}</output>
            <Button
              variant="secondary"
              onClick={() =>
                setGenerated(
                  generatePassword(Math.max(12, Math.min(128, length() || 24)))
                )
              }
            >
              {t('passwords.generate')}
            </Button>
            <Dropdown.Item
              onSelect={() => changeValue('password', generated())}
            >
              {t('passwords.usePassword')}
            </Dropdown.Item>
          </div>
        </Dropdown.Content>
      </Dropdown>
      <label class="flex flex-col gap-2 text-xs text-ink-muted">
        {t('passwords.website')}
        <Input
          type="url"
          value={props.draft.url}
          aria-invalid={props.validation === 'url'}
          onInput={(event) =>
            props.onChange({ ...props.draft, url: event.currentTarget.value })
          }
        />
        <Show when={props.validation === 'url'}>
          <span class="text-failure">{t('passwords.invalidUrl')}</span>
        </Show>
      </label>
      <label class="flex flex-col gap-2 text-xs text-ink-muted">
        {t('passwords.notes')}
        <Input
          value={props.draft.values.notes}
          onInput={(event) => changeValue('notes', event.currentTarget.value)}
        />
      </label>
      <For each={props.draft.values.fields}>
        {(field, index) => (
          <div class="flex flex-col gap-2 border-b border-edge-muted pb-3">
            <label class="text-xs text-ink-muted">
              {t('passwords.fieldLabel')}
              <Input
                value={field.label}
                onInput={(event) =>
                  props.onChange({
                    ...props.draft,
                    values: {
                      ...props.draft.values,
                      fields: props.draft.values.fields.map(
                        (value, position) =>
                          position === index()
                            ? { ...value, label: event.currentTarget.value }
                            : value
                      ),
                    },
                  })
                }
              />
            </label>
            <label class="text-xs text-ink-muted">
              {t('passwords.fieldValue')}
              <Input
                type="password"
                autocomplete="off"
                value={field.value}
                onInput={(event) =>
                  props.onChange({
                    ...props.draft,
                    values: {
                      ...props.draft.values,
                      fields: props.draft.values.fields.map(
                        (value, position) =>
                          position === index()
                            ? { ...value, value: event.currentTarget.value }
                            : value
                      ),
                    },
                  })
                }
              />
            </label>
            <Button
              variant="ghost"
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
              {t('passwords.removeField')}
            </Button>
          </div>
        )}
      </For>
      <Button
        variant="ghost"
        onClick={() =>
          props.onChange({
            ...props.draft,
            values: {
              ...props.draft.values,
              fields: [...props.draft.values.fields, { label: '', value: '' }],
            },
          })
        }
      >
        {t('passwords.addField')}
      </Button>
      <Dropdown>
        <Dropdown.Trigger>{t('passwords.move')}</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Item
            onSelect={() => props.onChange({ ...props.draft, folderId: null })}
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
                {folder.name}
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Content>
      </Dropdown>
      <Checkbox
        checked={props.draft.favorite}
        onChange={(favorite) => props.onChange({ ...props.draft, favorite })}
      >
        <Checkbox.Control />
        <Checkbox.Label>{t('passwords.favorite')}</Checkbox.Label>
      </Checkbox>
    </div>
  );
}
