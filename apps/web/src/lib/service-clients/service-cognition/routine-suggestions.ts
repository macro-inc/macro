/**
 * Client for routine suggestions on the document cognition service (the
 * `routine_suggestions` crate's `/routine-suggestions` routes).
 */
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { RoutineSuggestionSet } from './generated/schemas/routineSuggestionSet';

export type { RoutineSuggestionSet };

const dcsHost: string = SERVER_HOSTS['cognition-service'];

export const routineSuggestionsClient = {
  /**
   * The user's suggestions. The server starts generating them when there are
   * none or they are a few days old; poll while `status` is `generating`.
   */
  async get() {
    return await fetchWithToken<RoutineSuggestionSet>(
      `${dcsHost}/routine-suggestions`,
      { method: 'GET' }
    );
  },

  /** Starts a fresh generation unless one is already running. */
  async refresh() {
    return await fetchWithToken<RoutineSuggestionSet>(
      `${dcsHost}/routine-suggestions/refresh`,
      { method: 'POST' }
    );
  },
};
