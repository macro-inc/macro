import { access } from '@app/lib/signals/access';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { UrqlClientSource } from './types';

const UrqlClientContext = createContext<Accessor<Client>>();

/** Props for the application-local urql client provider. */
export type UrqlProviderProps = ParentProps<{
  /** A fixed client or reactive client accessor. */
  client: UrqlClientSource;
}>;

/** Provides the default urql client used by descendant queries. */
export function UrqlProvider(props: UrqlProviderProps) {
  const client = (): Client => access(props.client);

  return (
    <UrqlClientContext.Provider value={client}>
      {props.children}
    </UrqlClientContext.Provider>
  );
}

/** Returns the nearest reactive urql client, when a provider is present. */
export function useOptionalUrqlClient(): Accessor<Client> | undefined {
  return useContext(UrqlClientContext);
}

/** Returns the nearest reactive urql client or throws when none is provided. */
export function useUrqlClient(): Accessor<Client> {
  const client = useOptionalUrqlClient();
  if (!client) {
    throw new Error('useUrqlClient must be used within an UrqlProvider');
  }
  return client;
}
