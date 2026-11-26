import type { EmailViewState } from '../types';

export function linkInView(
  state: Pick<EmailViewState, 'inboxIds' | 'aliasFilter'>,
  linkId: string
): boolean {
  return (
    (state.inboxIds === undefined || state.inboxIds.includes(linkId)) &&
    (!state.aliasFilter || state.aliasFilter.inboxId === linkId)
  );
}
