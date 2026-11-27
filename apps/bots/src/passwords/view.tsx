import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { useLocation } from '@solidjs/router';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { type EditorMode, guidanceHelp, PasswordEditor } from './editor';
import { createPasswordFixture, sampleTeam, sampleTeamName } from './fixture';
import {
  fieldLabel,
  type Item,
  isSecret,
  kinds,
  layouts,
  type Readiness,
  type SaveItem,
} from './storage';
import './style.css';

const readinessLabels: Record<Readiness, string> = {
  ready: 'Ready',
  empty: 'Setup required',
  incompatible: 'Incompatible',
  recovery: 'Recovery needed',
};

function PasswordVault(props: { query: string }) {
  const storage = createPasswordFixture(props.query);
  const [vault, setVault] = createSignal(storage.read(sampleTeam));
  const [folder, setFolder] = createSignal('');
  const [selectedId, select] = createSignal(
    new URLSearchParams(props.query).get('item')
  );
  const [editor, setEditor] = createSignal<EditorMode>();
  const [notice, setNotice] = createSignal('');
  let nextKind: Item['kind'] | undefined;
  let heading: HTMLHeadingElement | undefined;
  let addButton: HTMLButtonElement | undefined;
  let editButton: HTMLButtonElement | undefined;

  const items = createMemo(() =>
    vault().items.filter((item) => !folder() || item.folderId === folder())
  );
  const selected = createMemo(() => {
    const item = items().find((item) => item.id === selectedId()) ?? items()[0];
    if (item) return storage.detail(sampleTeam, item.id);
  });

  function showItem(id: Item['id']) {
    setEditor(undefined);
    setNotice('');
    select(id);
    heading?.focus();
  }

  function cancel() {
    const editing = !!editor()?.existing;
    setEditor(undefined);
    if (editing) editButton?.focus();
    else addButton?.focus();
  }

  function save(item: SaveItem) {
    const id = storage.save(sampleTeam, item);
    setVault(storage.read(sampleTeam));

    if (!id) {
      if (!vault().canCreate && !editor()?.existing) setEditor(undefined);
      setNotice(
        vault().readiness === 'incompatible' || vault().readiness === 'recovery'
          ? ''
          : 'Item could not be saved. Check the item and try again.'
      );
      return;
    }

    setFolder('');
    showItem(id);
    setNotice(item.id ? 'Item updated.' : 'Item added.');
  }

  return (
    <div class="passwords">
      <p class="password-team">
        Macro team · <strong>{sampleTeamName}</strong> · {vault().role}
      </p>
      <section class="panel password-vault" aria-labelledby="passwords-title">
        <header class="password-bar">
          <h1 id="passwords-title">Passwords</h1>
          <span
            class="password-status"
            data-ready={vault().readiness === 'ready'}
          >
            {readinessLabels[vault().readiness]}
          </span>
          <Show when={vault().canCreate}>
            <DropdownMenu>
              <DropdownMenu.Trigger
                class="primary"
                ref={(element) => {
                  addButton = element;
                }}
              >
                + Add item
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  class="password-kind-menu"
                  aria-label="Choose item type"
                  onCloseAutoFocus={() => {
                    if (!nextKind) return;

                    const kind = nextKind;
                    nextKind = undefined;
                    // The menu restores trigger focus before the editor can take it.
                    queueMicrotask(() => {
                      setNotice('');
                      setEditor({ kind });
                    });
                  }}
                >
                  <For each={kinds}>
                    {(kind) => (
                      <DropdownMenu.Item
                        class="password-kind"
                        onSelect={() => {
                          nextKind = kind;
                        }}
                      >
                        <strong>{layouts[kind].label}</strong>
                        <span>{layouts[kind].description}</span>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </Show>
        </header>
        <div class="password-split">
          <section class="password-list" aria-label="Password items">
            <div class="password-list-title">
              <h2>Items</h2>
              <span>{items().length}</span>
            </div>
            <Show when={vault().readiness === 'ready'}>
              <div class="password-folders" role="group" aria-label="Folders">
                <For each={[{ id: '', name: 'All' }, ...vault().folders]}>
                  {(entry) => (
                    <button
                      type="button"
                      aria-pressed={folder() === entry.id}
                      onClick={() => {
                        setFolder(entry.id);
                        setEditor(undefined);
                        setNotice('');
                      }}
                    >
                      {entry.name}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <For
              each={items()}
              fallback={
                <p class="password-list-empty">
                  No items {folder() ? 'in this folder' : 'yet'}.
                </p>
              }
            >
              {(item) => (
                <button
                  type="button"
                  class="password-item"
                  aria-current={selected()?.id === item.id ? 'true' : undefined}
                  onClick={() => showItem(item.id)}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {layouts[item.kind].label} · {item.creator}
                    </small>
                  </span>
                  <small data-has-agents={item.agentCount > 0}>
                    {accessSummary(item.agentCount)}
                  </small>
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
                  when={selected()}
                  fallback={
                    <VaultStatus
                      readiness={vault().readiness}
                      canCreate={vault().canCreate}
                    />
                  }
                >
                  {(item) => (
                    <PasswordDetail
                      item={item()}
                      folderName={
                        vault().folders.find(
                          (entry) => entry.id === item().folderId
                        )?.name
                      }
                      headingRef={(element) => {
                        heading = element;
                      }}
                      editRef={(element) => {
                        editButton = element;
                      }}
                      edit={() => {
                        const latest = storage.detail(sampleTeam, item().id);
                        if (latest?.canEdit) {
                          setNotice('');
                          setEditor({ kind: latest.kind, existing: latest });
                        }
                      }}
                    />
                  )}
                </Show>
              }
            >
              {(mode) => (
                <PasswordEditor
                  mode={mode}
                  folders={vault().folders}
                  setup={vault().readiness === 'empty'}
                  save={save}
                  cancel={cancel}
                />
              )}
            </Show>
            <p class="password-notice" role="status">
              {notice()}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function VaultStatus(props: { readiness: Readiness; canCreate: boolean }) {
  const message = () => {
    switch (props.readiness) {
      case 'incompatible':
        return 'This vault is incompatible. Ask a team admin to check the configuration.';
      case 'recovery':
        return 'This vault needs recovery. Ask a team admin to complete recovery.';
      case 'empty':
        return props.canCreate
          ? 'Add the first item to set up the local fixture vault.'
          : 'A team admin can set up this vault.';
      default:
        return 'Choose another folder to find an item.';
    }
  };

  return (
    <p class="password-empty" role="status">
      {message()}
    </p>
  );
}

function accessSummary(count: number) {
  if (!count) return 'No agents';
  return count === 1 ? '1 agent' : `${count} agents`;
}

function PasswordDetail(props: {
  item: Item;
  folderName?: string;
  headingRef: (element: HTMLHeadingElement) => void;
  editRef: (element: HTMLButtonElement) => void;
  edit: () => void;
}) {
  return (
    <>
      <header class="password-detail-head">
        <div>
          <h2 ref={props.headingRef} tabIndex={-1}>
            {props.item.name}
          </h2>
          <p>
            {layouts[props.item.kind].label} · Created by {props.item.creator}
          </p>
        </div>
        <Show when={props.item.canEdit}>
          <button type="button" ref={props.editRef} onClick={props.edit}>
            Edit
          </button>
        </Show>
      </header>

      <section class="password-section" aria-label="Details">
        <h3>Details</h3>
        <dl>
          <div>
            <dt>Vault</dt>
            <dd>{sampleTeamName}</dd>
          </div>
          <div>
            <dt>Folder</dt>
            <dd>{props.folderName ?? 'No folder'}</dd>
          </div>
          <div>
            <dt>Visibility</dt>
            <dd>
              {props.item.sharedWithTeam
                ? 'Team'
                : 'Restricted (admins and creator)'}
            </dd>
          </div>
          <For each={layouts[props.item.kind].fields}>
            {(field) => {
              const value = () =>
                isSecret(field)
                  ? props.item.filled[field]
                  : props.item.fields[field];
              return (
                <Show when={value()}>
                  <div>
                    <dt>{fieldLabel(props.item.kind, field)}</dt>
                    <dd>
                      {isSecret(field) ? (
                        <>
                          <span aria-hidden="true" class="password-mask">
                            ••••••••••••
                          </span>{' '}
                          <small>Masked</small>
                        </>
                      ) : (
                        value()
                      )}
                    </dd>
                  </div>
                </Show>
              );
            }}
          </For>
        </dl>
      </section>

      <Show when={props.item.kind === 'card'}>
        <section class="password-section" aria-label="Use when">
          <h3>Use when</h3>
          <p class="password-guidance-text">
            {props.item.fixtureUseWhen || 'No guidance added.'}
          </p>
          <small>{guidanceHelp}</small>
        </section>
      </Show>

      <section class="password-section" aria-label="Agent access">
        <h3>Agent access</h3>
        <p>
          {props.item.agentCount
            ? `${accessSummary(props.item.agentCount)} with access.`
            : 'No agents have access.'}
        </p>
        <small>Manage agent access separately in Brain.</small>
      </section>
    </>
  );
}

export default function Passwords() {
  const location = useLocation();

  return (
    <Show when={location.search || '?'} keyed>
      {(query) => <PasswordVault query={query} />}
    </Show>
  );
}
