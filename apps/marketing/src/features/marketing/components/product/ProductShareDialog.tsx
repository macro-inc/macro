import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { PersonIcon } from '../workspace/frozen/TaskProperties';

/** Presentation port of Macro's Share form. Recipients and access stay local. */
export function ProductShareDialog(props: {
  open: boolean;
  title: string;
  kind?: string;
  onClose: () => void;
}) {
  const titleId = createUniqueId();
  const recipientId = createUniqueId();
  const [person, setPerson] = createSignal('');
  const [shared, setShared] = createSignal<{ person: string; level: string }>();
  const [level, setLevel] = createSignal('Edit');
  return (
    <Show when={props.open}>
      <div class="product-share-scrim">
        <div
          class="product-share-form glass-input"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
        >
          <header>
            <h3 id={titleId}>Share: {props.title}</h3>
            <Button
              variant="plain"
              size="icon-sm"
              label="Close sharing"
              onClick={props.onClose}
            >
              <X />
            </Button>
          </header>
          <div class="product-share-recipient">
            <label for={recipientId}>To:</label>
            <select
              id={recipientId}
              aria-label="Email or group"
              value={person()}
              onChange={(e) => setPerson(e.currentTarget.value)}
            >
              <option value="">Email or group</option>
              <option value="teo">Teo Nys</option>
              <option value="julia">Julia Westphal</option>
            </select>
            <select
              aria-label="Access level"
              value={level()}
              onChange={(e) => setLevel(e.currentTarget.value)}
            >
              <option>Edit</option>
              <option>Comment</option>
              <option>View</option>
            </select>
          </div>
          <textarea
            aria-label="Optional message"
            placeholder="Optional message"
          />
          <div class="product-share-actions">
            <Button variant="plain" size="sm" onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!person()}
              onClick={() => setShared({ person: person(), level: level() })}
            >
              Share
            </Button>
          </div>
          <div class="product-share-access">
            <p>People with access to this {props.kind ?? 'document'}</p>
            <div>
              <PersonIcon person="jacob" />
              <span>Me</span>
              <span>Owner</span>
            </div>
            <Show when={shared()}>
              <div>
                <PersonIcon
                  person={shared()?.person === 'teo' ? 'teo' : 'julia'}
                />
                <span>
                  {shared()?.person === 'teo' ? 'Teo Nys' : 'Julia Westphal'}
                </span>
                <span>{shared()?.level}</span>
              </div>
            </Show>
            <p class="mt-4">Link sharing scope</p>
            <span>None</span>
            <p class="text-xs text-ink-muted mt-2">
              Only people with access can open this {props.kind ?? 'document'}.
            </p>
          </div>
        </div>
      </div>
    </Show>
  );
}
