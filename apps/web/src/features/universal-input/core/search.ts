import { parseSearchFilters } from '../../next-soup/core/search-filters';
import { type Recipient, resolveRecipientTerms } from './recipients';

/** Resolve against the directory; ambiguous or missing identities cannot broaden a search. */
export function resolveSearchFilters(
  value: string,
  people: Recipient[],
  channels: Recipient[],
  inboxes: { id: string; email_address: string }[] = []
) {
  const draft = parseSearchFilters(value);
  const unresolved: string[] = [];
  const resolve = (terms: string[], options: Recipient[]) => {
    const result = resolveRecipientTerms(terms, options, false);
    unresolved.push(...result.unresolved);
    return [
      ...result.recipients.map((recipient) => recipient.id),
      ...result.unresolved,
    ];
  };
  const state = { ...draft };
  if (draft.type === 'channels')
    state.channels = {
      in: resolve(draft.channels.in, channels),
      from: resolve(draft.channels.from, people),
    };
  if (draft.type === 'calls')
    state.calls = {
      ...draft.calls,
      in: resolve(draft.calls.in, channels),
      from: resolve(draft.calls.from, people),
    };
  if (draft.type === 'email' && draft.email.inboxIds)
    state.email = {
      ...draft.email,
      inboxIds: resolve(
        draft.email.inboxIds,
        inboxes.map((inbox) => ({
          id: inbox.id,
          email: inbox.email_address,
          label: inbox.email_address,
          kind: 'user',
        }))
      ),
    };
  if (draft.type === 'task')
    state.task = {
      ...draft.task,
      assignees: resolve(draft.task.assignees, people),
      createdBy: resolve(draft.task.createdBy, people),
    };
  return { state, draft, unresolved: [...new Set(unresolved)] };
}
