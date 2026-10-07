/** A form's controls in the share dialog's link area, supplied by its host. */

import { useCopyLink } from '@core/util/useCopyLink';
import Copy from '@phosphor/copy.svg';
import { CopyButton } from '@ui';
import { Show } from 'solid-js';
import { AudiencePanel } from './components/share/audience-panel';
import type { FormAudience, FormDetail } from './core/form-model';

export function FormLinkSharing(props: {
  detail: FormDetail;
  respondLink: string;
  /** Where editors open the form; respondents never see it. */
  editorLink: string;
  pending: boolean;
  onAudienceChange: (audience: FormAudience) => void;
  onCopyFailure: () => void;
}) {
  const copy = useCopyLink();
  return (
    <div class="flex flex-col gap-3">
      <AudiencePanel
        audience={props.detail.form.audience}
        canChange={props.detail.access === 'owner'}
        respondLink={props.respondLink}
        pending={props.pending}
        onChange={props.onAudienceChange}
        onCopyFailure={props.onCopyFailure}
      />
      <Show when={props.detail.access !== 'view'}>
        <div class="flex justify-end border-t border-edge-muted pt-3">
          <CopyButton
            variant="outline"
            onClick={() => copy(props.editorLink, { silent: true })}
          >
            <Copy class="size-4" />
            Copy editor link
          </CopyButton>
        </div>
      </Show>
    </div>
  );
}
