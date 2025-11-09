import { createClient, fetchExchange } from '@urql/core';
import { devtoolsExchange } from '@urql/devtools';
import { offlineExchange } from '@urql/exchange-graphcache';
import { makeDefaultStorage } from '@urql/exchange-graphcache/default-storage';
import schema from '../internal/generated/introspectedSchema';

const storage = makeDefaultStorage({ maxAge: 365 });
export const clearStorage = () => storage.clear();

// setup offline cache for data
const cache = offlineExchange({
  storage,
  schema,
  updates: {
    Mutation: {
      logout(_result, _args, cache, _info) {
        cache.invalidate('Query', 'me');
      },
      verify(_result, _args, cache, _info) {
        // we just invalidate the existing permissions cache and let the next query fetch the new permissions
        // commenting out the code below that links the permissions to the me query
        cache.invalidate('Query', 'me');

        // const permissions = (result as VerifyCodeMutation)?.verify?.permissions;
        // cache.link("Query", "me", permissions);
      },
    },
  },
});
const newClient = () => {
  const isDev = import.meta.env.MODE === 'development';
  const init = isDev ? [devtoolsExchange] : [];
  const headers = isDev
    ? {
        'X-Allow-Introspection': import.meta.env.__LOCAL_GQL_SERVER__
          ? 'test_key'
          : 'fdsalkfsdalkjfiosadjvld124086',
      }
    : undefined;
  return createClient({
    url: import.meta.env.__MACRO_GQL_SERVICE__,
    fetchOptions: {
      credentials: 'include',
      headers,
    },
    exchanges: [...init, cache, fetchExchange],
  });
};
var urqlClient = newClient();
export const getUrqlClient = () => urqlClient;
export const getNewUrqlClient = () => {
  urqlClient = newClient();
  return urqlClient;
};
