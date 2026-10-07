import Copy from '@phosphor/copy.svg';
import { CopyButton, SegmentedControl } from '@ui';
import { createUniqueId, Show } from 'solid-js';
import type { FormAudience } from '../../core/form-model';

/** Native link-sharing controls for a form's respondents. */
export function AudiencePanel(props: {
  audience: FormAudience;
  canChange: boolean;
  respondLink: string;
  pending: boolean;
  onChange: (audience: FormAudience) => void;
  onCopyFailure: () => void;
}) {
  const titleId = createUniqueId();
  return (
    <section class="flex flex-col gap-3 text-sm" aria-labelledby={titleId}>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 id={titleId} class="font-medium text-ink">
          Who can respond
        </h3>
        <SegmentedControl<FormAudience>
          aria-label="Who can respond"
          value={props.audience}
          options={[
            {
              value: 'members',
              label: 'Invited people',
              disabled: !props.canChange || props.pending,
            },
            {
              value: 'public',
              label: 'Anyone with the link',
              disabled: !props.canChange || props.pending,
            },
          ]}
          onChange={props.onChange}
        />
      </div>
      <p class="text-sm text-ink-muted">
        {props.audience === 'public'
          ? 'Anyone with the link can fill out this form. No sign-in needed.'
          : 'Only people you’ve shared this form with can fill it out.'}
      </p>
      <Show when={!props.canChange}>
        <p class="text-xs text-ink-muted">Only the owner can change this.</p>
      </Show>
      <CopyButton
        variant="outline"
        class="self-start"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(props.respondLink);
            return true;
          } catch {
            props.onCopyFailure();
            return false;
          }
        }}
      >
        <Copy class="size-4" />
        Copy form link
      </CopyButton>
    </section>
  );
}
