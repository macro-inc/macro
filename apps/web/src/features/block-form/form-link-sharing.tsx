/** Form link controls for every entry into Macro's shared share dialog. */
import { toast } from '@core/component/Toast/Toast';
import { getWebOrigin } from '@core/util/webOrigin';
import { Show } from 'solid-js';
import { AudiencePanel } from './components/share/audience-panel';
import { respondLink } from './core/respond-link';
import { createAudienceChange } from './primitives/create-audience-change';
import {
  createFormDetailSource,
  updateFormMetadata,
} from './queries/form-sources';

export default function FormLinkSharing(props: { formId: string }) {
  const source = createFormDetailSource(() => props.formId);
  const audience = createAudienceChange({
    detail: source.detail,
    updateMetadata: updateFormMetadata,
    notify: {
      success: (message) => toast.success(message),
      failure: (message) => toast.failure(message),
    },
  });
  return (
    <Show
      when={source.detail()}
      fallback={
        <p role="status" class="text-sm text-ink-muted">
          {source.failure()
            ? 'Form sharing couldn’t be loaded. Reopen sharing to try again.'
            : 'Loading form sharing…'}
        </p>
      }
    >
      {(detail) => (
        <AudiencePanel
          audience={detail().form.audience}
          canChange={detail().access === 'owner'}
          respondLink={respondLink(`${getWebOrigin()}/app/`, props.formId)}
          pending={audience.pending()}
          onChange={(next) => void audience.change(next)}
          onCopyFailure={() => toast.failure('Could not copy form link.')}
        />
      )}
    </Show>
  );
}
