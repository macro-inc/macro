import Copy from '@phosphor/copy.svg';
import Globe from '@phosphor/globe.svg';
import UsersThree from '@phosphor/users-three.svg';
import { CopyButton, cn } from '@ui';
import { createUniqueId, For, Show } from 'solid-js';
import type { FormAudience } from '../../core/form-model';

const AUDIENCES: {
  value: FormAudience;
  title: string;
  body: string;
}[] = [
  {
    value: 'members',
    title: 'Workspace members',
    body: 'Respondents sign in with Macro. One response per person, editable until the form closes.',
  },
  {
    value: 'public',
    title: 'Anyone with the link',
    body: 'No sign-in needed: visitors who aren’t signed in respond anonymously. People signed in to Macro respond as themselves and can edit their response. File upload questions aren’t allowed.',
  },
];

/**
 * Who can respond (owner only), the respond link, and what each share role
 * means on a form.
 */
export function AudiencePanel(props: {
  audience: FormAudience;
  canChange: boolean;
  respondLink: string;
  pending: boolean;
  onChange: (audience: FormAudience) => void;
}) {
  // One per mount: the Share tab and the share dialog can show it at once.
  const titleId = createUniqueId();
  const groupName = createUniqueId();
  const radios = new Map<FormAudience, HTMLInputElement>();
  return (
    <section class="flex flex-col gap-3" aria-labelledby={titleId}>
      <div class="flex flex-col gap-0.5">
        <h3 id={titleId} class="text-sm font-semibold text-ink">
          Who can respond
        </h3>
        <p class="text-xs text-ink-muted">
          View can respond. Edit can change questions and edit responses: it
          grants edit on the linked database, its rows and columns.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={titleId}
        class="flex flex-col gap-2"
      >
        <For each={AUDIENCES}>
          {(choice) => (
            <label
              class={cn(
                'flex items-start gap-3 rounded-lg border px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-edge-focus',
                props.audience === choice.value
                  ? 'border-accent bg-accent-bg/40'
                  : 'border-edge-muted',
                props.canChange && !props.pending
                  ? 'hover:bg-hover'
                  : 'opacity-70'
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={choice.value}
                checked={props.audience === choice.value}
                disabled={!props.canChange || props.pending}
                class="mt-0.5 size-4 accent-accent"
                ref={(input) => radios.set(choice.value, input)}
                onChange={() => {
                  props.onChange(choice.value);
                  // The browser checked it already; show the saved audience
                  // until the change is saved, never one that was refused.
                  for (const [audience, radio] of radios)
                    radio.checked = audience === props.audience;
                }}
              />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Show
                    when={choice.value === 'public'}
                    fallback={<UsersThree class="size-4" aria-hidden="true" />}
                  >
                    <Globe class="size-4" aria-hidden="true" />
                  </Show>
                  {choice.title}
                </span>
                <span class="text-xs text-ink-muted">{choice.body}</span>
              </span>
            </label>
          )}
        </For>
      </div>
      <Show when={!props.canChange}>
        <p class="text-xs text-ink-muted">Only the owner can change this.</p>
      </Show>
      <div class="flex items-center gap-2 rounded-lg border border-edge-muted bg-input px-2.5 py-1.5">
        <span class="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted">
          {props.respondLink}
        </span>
        <CopyButton
          variant="ghost"
          size="icon-sm"
          label="Copy respond link"
          onClick={() => navigator.clipboard.writeText(props.respondLink)}
        >
          <Copy />
        </CopyButton>
      </div>
    </section>
  );
}
