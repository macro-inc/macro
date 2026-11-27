import { A } from '@solidjs/router';
import {
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { session } from '../session';
import { type SignedEditorMode, SignedPasswordEditor } from './signed-editor';
import {
  type SignedItem,
  type SignedSave,
  signedPasswordStorage,
} from './signed-store';
import { kinds, layouts } from './storage';
import './style.css';

export default function SignedPasswords() {
  const [viewer] = createResource(() => session.getSession());
  const [ended, setEnded] = createSignal(false);
  const team = () => {
    const identity = viewer();
    return !ended() && identity?.status === 'signed-in'
      ? identity.team
      : undefined;
  };
  const [catalog, { refetch: reloadCatalog }] = createResource(
    () => team()?.id,
    (id) => signedPasswordStorage.list(id)
  );
  const items = () => {
    const snapshot = catalog();
    return !catalog.loading && snapshot?.status === 'ready'
      ? snapshot.value
      : [];
  };
  const [selectedId, setSelected] = createSignal<string>();
  const selected = createMemo(() => {
    const rows = items();
    return rows.find((item) => item.id === selectedId()) ?? rows[0];
  });
  const [detail, { refetch: reloadDetail }] = createResource(
    () => selected(),
    (item) => signedPasswordStorage.detail(item.teamId, item.id)
  );
  const current = () => {
    const result = detail();
    return !detail.loading &&
      result?.status === 'ready' &&
      result.value.id === selected()?.id
      ? result.value
      : undefined;
  };
  const [editor, setEditor] = createSignal<SignedEditorMode>();
  const [pending, setPending] = createSignal(false);
  const [notice, setNotice] = createSignal('');

  function choose(item: SignedItem) {
    if (pending()) return;
    setSelected(item.id);
    setEditor(undefined);
    setNotice('');
  }

  async function save(command: SignedSave) {
    const scope = team();
    if (pending() || !scope) return;
    setPending(true);
    setNotice('');
    const result = await signedPasswordStorage.save(scope.id, command);
    if (team()?.id !== scope.id) return;
    setPending(false);
    setEditor(undefined);
    if (result.status === 'signed-out') {
      setEnded(true);
      return;
    }
    if (result.status === 'ready') {
      setSelected(result.value.id);
      setNotice(command.method === 'POST' ? 'Item added.' : 'Item updated.');
    } else {
      setNotice(
        result.status === 'stale'
          ? 'The item changed. Review the current details before editing again.'
          : 'The save could not be confirmed. Review the vault before trying again.'
      );
    }
    // Refresh current metadata after success or an uncertain write. Never resend values.
    await reloadCatalog();
    await reloadDetail();
  }

  const signedOut = () =>
    ended() ||
    viewer()?.status === 'signed-out' ||
    catalog()?.status === 'signed-out' ||
    detail()?.status === 'signed-out';
  const ready = () => catalog()?.status === 'ready' && !!team();

  return (
    <div class="passwords">
      <Show when={team()}>
        {(scope) => (
          <p class="password-team">
            Macro team · <strong>{scope().name}</strong>
          </p>
        )}
      </Show>
      <section
        class="panel password-vault"
        aria-labelledby="signed-passwords-title"
      >
        <header class="password-bar">
          <h1 id="signed-passwords-title">Passwords</h1>
          <Show when={ready() && !signedOut()}>
            <label>
              <span class="sr-only">Add item type</span>
              <select
                aria-label="Add item"
                value=""
                disabled={pending()}
                onChange={(event) => {
                  const kind = kinds.find(
                    (name) => name === event.currentTarget.value
                  );
                  event.currentTarget.value = '';
                  if (!kind || kind === 'verification_code') return;
                  setNotice('');
                  setEditor({ kind });
                }}
              >
                <option value="">+ Add item</option>
                <For each={kinds}>
                  {(kind) => (
                    <option
                      value={kind}
                      disabled={kind === 'verification_code'}
                    >
                      {layouts[kind].label}
                      {kind === 'verification_code'
                        ? ' (enrollment unavailable)'
                        : ''}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
        </header>
        <Switch>
          <Match when={signedOut()}>
            <p class="password-empty">
              Sign in to view team passwords.{' '}
              <A href="/sign-in?return=%2Fpasswords">Sign in</A>
            </p>
          </Match>
          <Match when={viewer.loading || (catalog.loading && !ready())}>
            <p class="password-empty" role="status">
              Loading team passwords…
            </p>
          </Match>
          <Match when={!ready()}>
            <p class="password-empty" role="status">
              Team passwords are unavailable.
            </p>
          </Match>
          <Match when={ready()}>
            <div class="password-split">
              <section class="password-list" aria-label="Password items">
                <div class="password-list-title">
                  <h2>Items</h2>
                  <span>{items().length}</span>
                </div>
                <For
                  each={items()}
                  fallback={<p class="password-list-empty">No items yet.</p>}
                >
                  {(item) => (
                    <button
                      type="button"
                      class="password-item"
                      disabled={pending()}
                      aria-current={
                        selected()?.id === item.id ? 'true' : undefined
                      }
                      onClick={() => choose(item)}
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>{layouts[item.kind].label}</small>
                      </span>
                    </button>
                  )}
                </For>
              </section>
              <div class="password-detail">
                <Show
                  when={editor()}
                  keyed
                  fallback={
                    <Show
                      when={current()}
                      fallback={
                        <p class="password-empty" role="status">
                          {detail.loading
                            ? 'Loading item…'
                            : selected()
                              ? 'This item is unavailable.'
                              : 'Add an item to get started.'}
                        </p>
                      }
                    >
                      {(item) => (
                        <>
                          <header class="password-detail-head">
                            <div>
                              <h2>{item().name}</h2>
                              <p>{layouts[item().kind].label}</p>
                            </div>
                            <Show when={item().canEdit}>
                              <button
                                type="button"
                                onClick={() => {
                                  setNotice('');
                                  setEditor({
                                    kind: item().kind,
                                    item: item(),
                                  });
                                }}
                              >
                                Edit
                              </button>
                            </Show>
                          </header>
                          <section
                            class="password-section"
                            aria-label="Details"
                          >
                            <h3>Details</h3>
                            <dl>
                              <div>
                                <dt>Visibility</dt>
                                <dd>
                                  {item().sharedWithTeam
                                    ? 'Team'
                                    : 'Restricted'}
                                </dd>
                              </div>
                              <Show when={item().url}>
                                <div>
                                  <dt>Website</dt>
                                  <dd>{item().url}</dd>
                                </div>
                              </Show>
                              <div>
                                <dt>Protected values</dt>
                                <dd>
                                  <span
                                    class="password-mask"
                                    aria-hidden="true"
                                  >
                                    ••••••••••••
                                  </span>{' '}
                                  <small>Masked</small>
                                </dd>
                              </div>
                            </dl>
                          </section>
                        </>
                      )}
                    </Show>
                  }
                >
                  {(mode) => (
                    <SignedPasswordEditor
                      mode={mode}
                      pending={pending()}
                      cancel={() => setEditor(undefined)}
                      save={(command) => {
                        void save(command);
                      }}
                    />
                  )}
                </Show>
                <p class="password-notice" role="status">
                  {notice()}
                </p>
              </div>
            </div>
          </Match>
        </Switch>
      </section>
    </div>
  );
}
