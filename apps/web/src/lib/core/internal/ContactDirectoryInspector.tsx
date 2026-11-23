import { fireAndForget } from '@core/util/fireAndForget';
import type { createContactDirectoryWindow } from '@queries/contacts/directory-query';
import { Button, inputClasses } from '@ui';
import { For, Show } from 'solid-js';

/** One visible page, with explicit cache/offline and continuation semantics.
 * This internal surface intentionally matches DataDebug's untranslated copy. */
export function ContactDirectoryInspector(props: {
  directory: ReturnType<typeof createContactDirectoryWindow>;
}) {
  const page = () => props.directory.data();
  return (
    <section
      class="min-w-0 border border-edge rounded-lg p-4"
      aria-label="Contact directory"
    >
      <h2 class="text-lg font-semibold mb-3 text-accent">
        Contacts — {page()?.users.length ?? 0} shown
      </h2>
      <input
        class={inputClasses({ class: 'w-full mb-2' })}
        aria-label="Search contacts"
        placeholder="Search names or email addresses"
        value={props.directory.search()}
        onInput={(event) =>
          props.directory.setSearch(event.currentTarget.value)
        }
      />
      <div class="text-xs text-ink-muted mb-2" role="status">
        <Show when={page()}>
          {(value) => (
            <>
              Local contacts · Cache {value().sync}
              <Show when={value().offline}> · Offline</Show>
              <Show when={value().query}>
                {' '}
                · Top cached matches; refine to narrow
              </Show>
            </>
          )}
        </Show>
        <Show when={props.directory.loading()}> · Loading contacts…</Show>
      </div>
      <Show when={props.directory.error()}>
        <p role="alert" class="text-sm mb-2">
          Unable to load contacts. Cached rows, if any, remain visible.
        </p>
        <Button
          variant="secondary"
          onClick={() =>
            fireAndForget(props.directory.retry(), 'contact-inspector')
          }
        >
          Retry
        </Button>
      </Show>
      <Show when={page()?.users.length === 0 && !props.directory.loading()}>
        <p class="text-sm text-ink-muted">
          {page()?.nextCursor
            ? 'No matches on this page. Continue searching the directory.'
            : 'No matches in this snapshot or page. Cached data may be incomplete.'}
        </p>
      </Show>
      <div
        class="max-h-60 overflow-y-auto space-y-2"
        aria-label="Contact results"
        aria-busy={props.directory.loading()}
      >
        <For each={page()?.users ?? []}>
          {(user) => (
            <div
              class="bg-panel p-2 rounded text-sm break-words"
              data-contact-id={user.id}
            >
              <div class="font-medium">{user.name}</div>
              <div>{user.email}</div>
              <div class="text-ink-muted">ID: {user.id}</div>
            </div>
          )}
        </For>
      </div>
      <div class="flex flex-wrap gap-2 mt-3">
        <Button
          variant="secondary"
          disabled={props.directory.loading()}
          onClick={props.directory.restart}
        >
          Refresh contacts
        </Button>
        <Button
          variant="secondary"
          disabled={props.directory.loading() || !page()?.nextCursor}
          onClick={props.directory.next}
        >
          Next page
        </Button>
      </div>
      <details class="border-t border-edge mt-3 pt-3">
        <summary class="text-accent text-sm">Visible page JSON</summary>
        <Button
          variant="secondary"
          onClick={() =>
            fireAndForget(
              navigator.clipboard.writeText(
                JSON.stringify(page()?.users ?? [], null, 2)
              ),
              'contact-inspector'
            )
          }
        >
          Copy visible page
        </Button>
        <pre class="text-xs mt-2 max-h-80 overflow-auto">
          {JSON.stringify(page()?.users ?? [], null, 2)}
        </pre>
      </details>
    </section>
  );
}
