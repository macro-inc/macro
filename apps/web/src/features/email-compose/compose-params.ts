import type { ComponentProps } from 'solid-js';
import type { EmailCompose } from './email-compose';

type EmailComposeProps = ComponentProps<typeof EmailCompose>;

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Recipients a link names as `to=a@example.com,b@example.com`, as mailto:
 * links do.
 */
export function recipientsFromLink(
  value: string | null | undefined
): string[] | undefined {
  const recipients = value
    ?.split(',')
    .map((recipient) => recipient.trim())
    .filter(Boolean);
  return recipients?.length ? recipients : undefined;
}

/**
 * The composer's options from the params a new email opened with. Callers pass
 * them in memory, so a value of the wrong type is dropped rather than trusted.
 */
export function composePropsFromParams(
  params: Record<string, unknown> | undefined
): EmailComposeProps {
  const initialTo = Array.isArray(params?.initialTo)
    ? params.initialTo.filter(
        (value): value is string => typeof value === 'string'
      )
    : undefined;
  const initialAttachments = Array.isArray(params?.initialAttachments)
    ? params.initialAttachments.filter(
        (value): value is File => value instanceof File
      )
    : undefined;

  return {
    draftId: stringParam(params?.draftID),
    initialTo,
    initialInboxId: stringParam(params?.initialInboxId),
    initialSubject: stringParam(params?.initialSubject),
    initialBodyText: stringParam(params?.initialBodyText),
    initialAttachments,
  };
}
