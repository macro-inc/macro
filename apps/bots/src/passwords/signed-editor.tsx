import type {
  PasswordPatchItem,
  PasswordSecretValues,
} from '@macro-inc/sdk/generated/storage';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { v7 } from 'uuid';
import type { SignedItem, SignedSave } from './signed-store';
import { fieldLabel, layouts } from './storage';

export type SignedEditorMode = {
  kind: SignedItem['kind'];
  item?: SignedItem;
};

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function values(
  kind: SignedItem['kind'],
  form: FormData
): PasswordSecretValues {
  const value: PasswordSecretValues = {
    username: '',
    password: '',
    notes: field(form, 'notes'),
    fields: [],
  };
  const add = (input: string, label: string) => {
    const entry = field(form, input);
    if (entry) value.fields.push({ label, value: entry });
  };
  switch (kind) {
    case 'login':
      value.username = field(form, 'username');
      value.password = field(form, 'password');
      break;
    case 'card':
      value.username = field(form, 'cardholder');
      value.password = field(form, 'cardNumber');
      add('expiration', 'Expires');
      add('securityCode', 'Security code');
      break;
    case 'note':
      value.notes = field(form, 'note');
      break;
    case 'identity':
      value.username = field(form, 'fullName');
      add('email', 'Email');
      add('phone', 'Phone');
      add('address', 'Address');
      break;
    case 'api':
      value.username = field(form, 'apiKey');
      value.password = field(form, 'apiSecret');
      add('environment', 'Environment');
      break;
  }
  return value;
}

export function SignedPasswordEditor(props: {
  mode: SignedEditorMode;
  pending: boolean;
  save: (command: SignedSave) => void;
  cancel: () => void;
}) {
  const [replace, setReplace] = createSignal(false);
  const editing = () => Boolean(props.mode.item);
  const showValues = () => !editing() || replace();
  const hasWebsite = () => ['login', 'api'].includes(props.mode.kind);
  const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (event) => {
    event.preventDefault();
    if (props.pending) return;
    const form = event.currentTarget;
    const input = new FormData(form);
    const item = props.mode.item;
    const kind = props.mode.kind;
    const name = field(input, 'name').trim();
    if (!name) return;

    const metadata = {
      kind,
      name,
      favorite: item?.favorite ?? false,
      folderId: item?.folderId ?? null,
      url: hasWebsite() ? field(input, 'website').trim() || null : item?.url,
    };
    if (item && !replace()) {
      const body: PasswordPatchItem = {
        ...metadata,
        expectedVersion: item.version,
      };
      props.save({ method: 'PATCH', id: item.id, body });
      return;
    }

    const body = {
      ...metadata,
      operationId: v7(),
      expectedVersion: item?.version,
      private: !input.has('share'),
      values: values(kind, input),
    };
    for (const entry of form.querySelectorAll<HTMLInputElement>(
      'input[type=password]'
    )) {
      entry.value = '';
    }
    props.save(
      item ? { method: 'PUT', id: item.id, body } : { method: 'POST', body }
    );
  };

  return (
    <form class="password-editor" onSubmit={submit} autocomplete="off">
      <h2>
        {editing() ? 'Edit' : 'New'}{' '}
        {layouts[props.mode.kind].label.toLowerCase()}
      </h2>
      <fieldset
        disabled={props.pending}
        class="password-fields signed-password-fields"
      >
        <label>
          Name
          <input
            name="name"
            required
            maxLength={60}
            value={props.mode.item?.name ?? ''}
          />
        </label>
        <Show when={hasWebsite()}>
          <label>
            {props.mode.kind === 'api' ? 'Endpoint' : 'Website'}
            <input
              name="website"
              type="url"
              value={props.mode.item?.url ?? ''}
            />
          </label>
        </Show>
        <Show when={editing() && props.mode.kind !== 'verification_code'}>
          <label class="password-share">
            <input
              type="checkbox"
              checked={replace()}
              onChange={(event) => setReplace(event.currentTarget.checked)}
            />
            Replace saved values
          </label>
          <Show when={replace()}>
            <small>
              Enter the complete replacement. Blank values and old custom fields
              are cleared.
            </small>
          </Show>
        </Show>
        <Show when={showValues()}>
          <For
            each={layouts[props.mode.kind].fields.filter(
              (name) => name !== 'website' && name !== 'totp'
            )}
          >
            {(name) => (
              <label>
                {fieldLabel(props.mode.kind, name)}
                <input
                  type="password"
                  name={name}
                  autocomplete="new-password"
                />
              </label>
            )}
          </For>
        </Show>
        <Show when={!editing()}>
          <label class="password-share">
            <input type="checkbox" name="share" /> Let team members edit
          </label>
        </Show>
      </fieldset>
      <div class="password-actions">
        <button type="button" disabled={props.pending} onClick={props.cancel}>
          Cancel
        </button>
        <button class="primary" type="submit" disabled={props.pending}>
          {props.pending ? 'Saving…' : 'Save item'}
        </button>
      </div>
    </form>
  );
}
