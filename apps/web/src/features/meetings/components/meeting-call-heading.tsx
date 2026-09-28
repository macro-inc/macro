import { Button } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

export function MeetingCallHeading(props: {
  title: string;
  onRename?: (title: string) => Promise<void>;
}) {
  const [now, setNow] = createSignal(Date.now());
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal(false);
  onMount(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => globalThis.clearInterval(timer));
  });

  const currentTime = () =>
    new Date(now()).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });

  function edit() {
    setDraft(props.title);
    setError(false);
    setEditing(true);
  }

  async function save() {
    const title = draft().trim();
    if (!props.onRename || saving() || !title) return;
    if (title === props.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      await props.onRename(title);
      setEditing(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-3">
        <time
          aria-label="Current time"
          dateTime={new Date(now()).toISOString()}
          class="text-sm tabular-nums text-ink-muted"
        >
          {currentTime()}
        </time>
        <Show
          when={editing() && props.onRename}
          fallback={
            <h1 class="min-w-0 text-lg font-semibold">
              <Show when={props.onRename} fallback={props.title}>
                <button
                  type="button"
                  aria-label="Rename call"
                  class="flex items-center gap-2 rounded-md text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={edit}
                >
                  <span class="break-words">{props.title}</span>
                </button>
              </Show>
            </h1>
          }
        >
          <form
            class="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <input
              ref={(element) =>
                onMount(() => {
                  element.focus();
                  element.select();
                })
              }
              aria-label="Call name"
              class="min-w-0 rounded-lg border border-edge-muted bg-input px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
              value={draft()}
              maxLength={200}
              required
              disabled={saving()}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !saving()) setEditing(false);
              }}
            />
            <Button type="submit" disabled={saving() || !draft().trim()}>
              {saving() ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              disabled={saving()}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </form>
        </Show>
      </div>
      <Show when={editing() && error()}>
        <p role="alert" class="mt-2 text-xs text-failure">
          Could not rename the call. Try again.
        </p>
      </Show>
    </div>
  );
}
