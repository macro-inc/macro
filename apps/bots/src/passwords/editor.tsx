import { For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import {
  type Folder,
  fieldLabel,
  type Item,
  isSecret,
  layouts,
  type SaveItem,
  type SecretField,
} from './storage';

export type EditorMode =
  | { kind: Item['kind']; existing?: undefined }
  | { kind: Item['kind']; existing: Item };

export const guidanceHelp =
  'Local fixture guidance. Payment authority and agent approvals are separate.';

export function PasswordEditor(props: {
  mode: EditorMode;
  folders: readonly Folder[];
  setup: boolean;
  save: (item: SaveItem) => void;
  cancel: () => void;
}) {
  let itemName: HTMLInputElement | undefined;
  const secretInputs = new Map<SecretField, HTMLInputElement>();

  function clearSecrets() {
    for (const input of secretInputs.values()) input.value = '';
  }

  onMount(() => itemName?.focus());
  onCleanup(clearSecrets);

  const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (event) => {
    event.preventDefault();
    const form = event.currentTarget;

    const { kind, existing } = props.mode;
    const name = itemName?.value.trim() ?? '';
    if (!name) {
      itemName?.setCustomValidity('Enter an item name.');
      itemName?.reportValidity();
      return;
    }

    const fields: Item['fields'] = {};
    const filled: Item['filled'] = { ...existing?.filled };
    for (const field of layouts[kind].fields) {
      if (isSecret(field)) {
        const input = secretInputs.get(field);
        if (!input) continue;

        const hasValue = input.value.trim().length > 0;
        if (input.required && !hasValue) {
          input.setCustomValidity('Enter a verification code seed.');
          input.reportValidity();
          return;
        }
        if (hasValue) filled[field] = true;
      } else {
        const input = form.elements.namedItem(field);
        if (input instanceof HTMLInputElement)
          fields[field] = input.value.trim();
      }
    }
    clearSecrets();

    const folder = form.elements.namedItem('folder');
    const useWhen = form.elements.namedItem('useWhen');
    const share = form.elements.namedItem('share');
    const details = {
      name,
      folderId:
        folder instanceof HTMLSelectElement ? folder.value || null : null,
      fields,
      filled,
      fixtureUseWhen:
        useWhen instanceof HTMLTextAreaElement
          ? useWhen.value.trim()
          : undefined,
    };

    props.save(
      existing
        ? { ...details, id: existing.id, expectedVersion: existing.version }
        : {
            ...details,
            kind,
            private: !(share instanceof HTMLInputElement && share.checked),
          }
    );
  };

  return (
    <form class="password-editor" onSubmit={submit} autocomplete="off">
      <h2>
        {props.mode.existing ? 'Edit' : 'New'}{' '}
        {layouts[props.mode.kind].label.toLowerCase()}
      </h2>
      <div class="password-fields">
        <label>
          Name
          <input
            ref={(element) => {
              itemName = element;
            }}
            required
            maxLength={60}
            value={props.mode.existing?.name ?? ''}
            onInput={(event) => event.currentTarget.setCustomValidity('')}
          />
        </label>
        <div class="password-field">
          <label for="password-folder">Folder</label>
          <select
            id="password-folder"
            name="folder"
            value={props.mode.existing?.folderId ?? ''}
          >
            <option value="">No folder</option>
            <For each={props.folders}>
              {(folder) => <option value={folder.id}>{folder.name}</option>}
            </For>
          </select>
        </div>
        <For each={layouts[props.mode.kind].fields}>
          {(field) => {
            const label = fieldLabel(props.mode.kind, field);
            if (isSecret(field)) {
              const filled = props.mode.existing?.filled[field];
              return (
                <label>
                  {label}
                  <input
                    ref={(input) => secretInputs.set(field, input)}
                    type="password"
                    onInput={(event) =>
                      event.currentTarget.setCustomValidity('')
                    }
                    autocomplete="new-password"
                    inputmode={
                      field === 'cardNumber' || field === 'securityCode'
                        ? 'numeric'
                        : undefined
                    }
                    required={
                      field === 'totp' &&
                      props.mode.kind === 'verification_code' &&
                      !filled
                    }
                    placeholder={
                      filled ? 'Masked · enter to replace' : undefined
                    }
                  />
                </label>
              );
            }

            return (
              <label>
                {label}
                <input
                  name={field}
                  value={props.mode.existing?.fields[field] ?? ''}
                />
              </label>
            );
          }}
        </For>
        <Show when={props.mode.kind === 'card'}>
          <div class="password-guidance">
            <label for="password-guidance">Use when (optional)</label>
            <textarea
              id="password-guidance"
              name="useWhen"
              maxLength={240}
              rows={2}
              aria-describedby="password-guidance-help"
              value={props.mode.existing?.fixtureUseWhen ?? ''}
            />
            <small id="password-guidance-help">{guidanceHelp}</small>
          </div>
        </Show>
      </div>
      <Show when={!props.mode.existing}>
        <label class="password-share">
          <input type="checkbox" name="share" checked /> Share with team
        </label>
      </Show>
      <div class="password-actions">
        <button type="button" onClick={props.cancel}>
          Cancel
        </button>
        <button class="primary" type="submit">
          {props.setup ? 'Set up vault and save' : 'Save item'}
        </button>
      </div>
    </form>
  );
}
