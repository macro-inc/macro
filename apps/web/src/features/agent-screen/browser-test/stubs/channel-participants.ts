// The DM's two participants, without the participants query.
import { AGENT, ME } from './dm';

export function useChannelParticipants() {
  return { users: () => [], ids: () => [ME, AGENT] };
}
