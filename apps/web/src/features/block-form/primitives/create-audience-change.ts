import { type Accessor, createSignal } from 'solid-js';
import type { FormContext } from '../context/form-context';
import { audienceRefusal } from '../core/audience';
import type { FormAudience, FormDetail } from '../core/form-model';

/**
 * Changing who can respond, for every panel that offers it: refused changes
 * are told and nothing is sent; a sent one is pending until it answers.
 */
export function createAudienceChange(options: {
  detail: Accessor<FormDetail | undefined>;
  updateMetadata: FormContext['updateMetadata'];
  notify: FormContext['notify'];
}) {
  const [pending, setPending] = createSignal(false);
  async function change(audience: FormAudience) {
    const detail = options.detail();
    if (!detail || audience === detail.form.audience) return;
    const refusal = audienceRefusal(detail, audience);
    if (refusal) {
      options.notify.failure(refusal);
      return;
    }
    setPending(true);
    const result = await options.updateMetadata(detail.form.id, { audience });
    setPending(false);
    if (result.isErr())
      options.notify.failure(
        `Who can respond wasn’t saved: ${result.error.message}`
      );
  }
  return { change, pending };
}
