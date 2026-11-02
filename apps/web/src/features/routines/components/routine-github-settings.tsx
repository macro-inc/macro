import { ToggleSwitch } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type {
  GithubRepositoryOptions,
  GithubSelectorDraft,
} from '../core/routine-triggers';

function names(text: string) {
  return text
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/** A comma-separated list that keeps what the person typed while it parses it. */
function NameList(props: {
  label: string;
  placeholder: string;
  description: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [text, setText] = createSignal(props.value.join(', '));
  return (
    <label class="grid gap-1">
      <span class="text-xs font-medium">{props.label}</span>
      <input
        placeholder={props.placeholder}
        value={text()}
        onInput={(e) => {
          setText(e.currentTarget.value);
          props.onChange(names(e.currentTarget.value));
        }}
        class="w-full rounded-md border border-edge-muted bg-input px-2 py-1.5 text-xs outline-none focus:border-accent"
      />
      <span class="text-xs text-ink-extra-muted">{props.description}</span>
    </label>
  );
}

/** Which deliveries from Macro's GitHub app the trigger watches. */
export function RoutineGithubSettings(props: {
  selector: GithubSelectorDraft;
  repositories: GithubRepositoryOptions;
  onChange: (selector: GithubSelectorDraft) => void;
}) {
  const [search, setSearch] = createSignal('');
  const change = (patch: Partial<GithubSelectorDraft>) =>
    props.onChange({ ...props.selector, ...patch });
  const selected = (name: string) =>
    props.selector.repositories.some(
      (chosen) => chosen.toLowerCase() === name.toLowerCase()
    );
  const toggle = (name: string) =>
    change({
      repositories: selected(name)
        ? props.selector.repositories.filter(
            (chosen) => chosen.toLowerCase() !== name.toLowerCase()
          )
        : [...props.selector.repositories, name],
    });
  // Chosen repositories stay listed even when the app no longer reaches them.
  const options = () =>
    [...new Set([...props.selector.repositories, ...props.repositories.names])]
      .filter((name) =>
        name.toLowerCase().includes(search().trim().toLowerCase())
      )
      .toSorted(
        (left, right) => Number(selected(right)) - Number(selected(left))
      );
  return (
    <div class="grid gap-3">
      <NameList
        label="GitHub events"
        placeholder="Any event"
        description="Names GitHub sends, like workflow_run, pull_request or push."
        value={props.selector.events}
        onChange={(events) => change({ events })}
      />
      <NameList
        label="Actions"
        placeholder="Any action"
        description="Like completed, opened or closed. Events such as push have none."
        value={props.selector.actions}
        onChange={(actions) => change({ actions })}
      />
      <div class="grid gap-1">
        <span class="text-xs font-medium">Repositories</span>
        <input
          aria-label="Search repositories"
          placeholder={
            props.selector.repositories.length
              ? `${props.selector.repositories.length} selected · search…`
              : 'All repositories · search to narrow…'
          }
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="w-full rounded-md border border-edge-muted bg-input px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
        <div class="max-h-36 overflow-y-auto">
          <Show
            when={!props.repositories.loading}
            fallback={<p class="p-2 text-xs text-ink-muted">Loading…</p>}
          >
            <Show when={props.repositories.error}>
              <p class="p-2 text-xs text-failure">
                Your repositories couldn’t be listed.
              </p>
            </Show>
            <Show
              when={options().length}
              fallback={
                <p class="p-2 text-xs text-ink-muted">
                  Install Macro’s GitHub app to watch a repository.
                </p>
              }
            >
              <For each={options()}>
                {(name) => (
                  <label class="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-hover">
                    <input
                      type="checkbox"
                      checked={selected(name)}
                      onChange={() => toggle(name)}
                    />
                    <span class="truncate">{name}</span>
                  </label>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </div>
      <ToggleSwitch
        label="Also run for bots and apps"
        checked={props.selector.includeBots}
        onChange={(includeBots) => change({ includeBots })}
      />
      <Show when={props.selector.includeBots}>
        <p class="text-xs text-ink-muted">
          Includes Macro’s own app: make sure what this routine does on GitHub
          doesn’t trigger it again.
        </p>
      </Show>
    </div>
  );
}
