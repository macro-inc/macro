/** A thread message reduced to the fields that decide the thread's subject. */
type SubjectMessage = {
  subject?: string | null;
  is_draft?: boolean;
};

const hasSubject = (message: SubjectMessage): boolean =>
  !!message.subject && message.subject.trim().length > 0;

/**
 * Pick the message whose subject names the thread.
 *
 * Threads are returned newest-first, so `messages[0]` is not a safe proxy for
 * the subject: an unsent draft reply carries `sent_at = now` and usually no
 * subject, so it floats to the head of the thread. Taking its (empty) subject
 * renders the thread as "No Subject" even though a real message in it has one —
 * and a non-owner never sees the draft at all, so a limit-1 page comes back
 * empty for them. Prefer the newest non-draft message that has a subject, then
 * any message with a subject, and only fall back to the newest message when the
 * thread genuinely has no subject anywhere.
 */
export function representativeThreadMessage<T extends SubjectMessage>(
  messages: ReadonlyArray<T>
): T | undefined {
  return (
    messages.find((m) => !m.is_draft && hasSubject(m)) ??
    messages.find(hasSubject) ??
    messages[0]
  );
}
