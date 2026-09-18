import TrashIcon from '@phosphor/trash.svg';
import XIcon from '@phosphor/x.svg';
import { createSignal, type JSX, Show } from 'solid-js';
import { ArtifactDialog } from './ArtifactDialog';

/** Rename a conversation or agent in place. */
export function RenameDialog(props: {
  title?: string;
  value: string;
  pending?: boolean;
  onRename: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = createSignal(props.value);
  const submit = () => {
    const next = value().trim();
    if (!next || props.pending) return;
    props.onRename(next);
  };

  return (
    <ArtifactDialog
      class="narrow"
      label={props.title ?? 'Rename'}
      onClose={props.onClose}
    >
      <div class="dh" style={{ height: '40px', padding: '0 8px 0 12px' }}>
        <span class="t" style={{ 'font-weight': 600 }}>
          {props.title ?? 'Rename'}
        </span>
        <button type="button" class="icon-btn" aria-label="Close" data-close>
          <XIcon class="ph" />
        </button>
      </div>
      <div class="db">
        <input
          class="sinput"
          aria-label="Name"
          value={value()}
          onInput={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
      <div class="df">
        <button type="button" class="btn outline" data-close>
          Cancel
        </button>
        <button
          type="button"
          class="btn"
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-contrast)',
          }}
          disabled={props.pending || value().trim().length === 0}
          onClick={submit}
        >
          {props.pending ? 'Renaming…' : 'Rename'}
        </button>
      </div>
    </ArtifactDialog>
  );
}

/** A yes/no question before something irreversible. */
export function ConfirmDialog(props: {
  title: string;
  body: JSX.Element;
  confirmLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ArtifactDialog class="narrow" label={props.title} onClose={props.onClose}>
      <div class="dh" style={{ height: '40px', padding: '0 8px 0 12px' }}>
        <span class="t" style={{ 'font-weight': 600 }}>
          {props.title}
        </span>
        <button type="button" class="icon-btn" aria-label="Close" data-close>
          <XIcon class="ph" />
        </button>
      </div>
      <div class="db">
        <p
          style={{
            margin: 0,
            'font-size': '13.5px',
            'line-height': 1.5,
            color: 'var(--ink-muted)',
          }}
        >
          {props.body}
        </p>
      </div>
      <div class="df">
        <button type="button" class="btn outline" data-close>
          Cancel
        </button>
        <button
          type="button"
          class={props.danger ? 'btn danger' : 'btn'}
          style={
            props.danger
              ? undefined
              : {
                  background: 'var(--accent)',
                  color: 'var(--accent-contrast)',
                }
          }
          disabled={props.pending}
          onClick={props.onConfirm}
        >
          <Show when={props.danger}>
            <TrashIcon class="ph" />
          </Show>
          {props.pending
            ? (props.pendingLabel ?? 'Working…')
            : props.confirmLabel}
        </button>
      </div>
    </ArtifactDialog>
  );
}
