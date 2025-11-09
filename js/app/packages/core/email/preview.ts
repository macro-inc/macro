import { isErr } from '@core/util/maybeResult';
import { emailClient } from '@service-email/client';
import type { GetPreviewsCursorResponse } from '@service-email/generated/schemas';
import { createSingletonRoot } from '@solid-primitives/rootless';
import type { Accessor } from 'solid-js';
import { createMemo, createResource } from 'solid-js';

export type EmailPreview =
  GetPreviewsCursorResponse['previews']['items'][number];

// TODO
async function getPreviews() {
  const result = await emailClient.getPreviews({
    limit: 100,
    sort_method: 'updated_at',
    view: 'all',
  });

  if (isErr(result)) return;
  const [, previews] = result;
  return previews;
}

const emailsResource = createSingletonRoot(() => createResource(getPreviews));

export function usePreviewEmails(): Accessor<EmailPreview[]> {
  const [r] = emailsResource();
  return createMemo(() => {
    const result = r.latest;
    if (!result) return [];
    return result.previews.items;
  });
}
