import {
  getLoginCookieOptions,
  syncLoginStorage,
  updateCookie,
} from '@core/util/cookies';
import { thrownResultErrorHasCode } from '@core/util/result';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { setGraphqlSoupSessionActive } from '@service-storage/graphql-soup';
import { createEffect, on } from 'solid-js';

/** Keep session clients and login hints in sync with definitive auth results. */
export function useSyncLoginCookie() {
  const query = useUserInfoQuery();

  createEffect(
    on(
      () => {
        // A 401 wins over retained identity from a previous successful fetch.
        if (thrownResultErrorHasCode(query.error, 'UNAUTHORIZED')) return false;
        // Loading and transient failures must preserve offline session state.
        if (!query.isSuccess) return undefined;
        return query.data.authenticated ?? false;
      },
      (authenticated) => {
        if (authenticated === undefined) return;
        const { value, ...options } = getLoginCookieOptions(authenticated);
        updateCookie('login', value, options);
        syncLoginStorage(authenticated);
        setGraphqlSoupSessionActive(authenticated);
      }
    )
  );
}
