import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/host/types';
import { isStaleHydrationScopeError } from '@graphql-cache/protocol';
import { onlineManager } from '@tanstack/solid-query';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import {
  isCurrentQueryAccount,
  type QueryAccount,
} from '../auth/account-scope';
import type { PersonFacts } from './context-facts';
import {
  ContactContextCanceled,
  ContactContextPublisher,
} from './context-publisher';

export type ContactContextSyncState =
  | 'waiting'
  | 'publishing'
  | 'ready'
  | 'unsupported'
  | 'error';
const COALESCE_MS = 250;
const MAX_RETRIES = 3;

/** Lifecycle/scheduling only. Publisher owns batch admission and uncertain-write recovery. */
export function createContactContextSync(options: {
  account: Accessor<QueryAccount | undefined>;
  host: Accessor<CacheHost | undefined>;
  generation: Accessor<number>;
  source: Accessor<ReadonlyMap<string, PersonFacts> | undefined>;
  onUnsupported?: (unsupported: boolean) => void;
}): Accessor<ContactContextSyncState> {
  const [state, setState] = createSignal<ContactContextSyncState>('waiting');
  createEffect(
    on(
      [options.account, options.host, options.generation],
      ([account, host]) => {
        options.onUnsupported?.(false);
        setState('waiting');
        const cache = host?.people;
        if (!account || !host || host.disabled || !cache) return;
        let disposed = false;
        let terminal = false;
        let busy = false;
        let requested = false;
        let attempts = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let publisher: ContactContextPublisher | undefined;
        const current = () => !disposed && isCurrentQueryAccount(account);
        const schedule = (delay = COALESCE_MS) => {
          if (disposed || terminal) return;
          requested = true;
          if (busy || timer !== undefined) return;
          timer = setTimeout(() => {
            timer = undefined;
            fireAndForget(publish(), 'contacts-context');
          }, delay);
        };
        const publish = async () => {
          if (!current() || !untrack(options.source)) return;
          busy = true;
          requested = false;
          let retryDelay: number | undefined;
          try {
            if (!publisher) {
              const storageGeneration = await host.currentStorageGeneration();
              if (!current()) throw new ContactContextCanceled();
              publisher = new ContactContextPublisher(
                cache,
                { identity: account.userId, storageGeneration },
                current
              );
            }
            publisher.replace(untrack(options.source));
            setState('publishing');
            const result = await publisher.flush();
            if (!current()) return;
            setState(result);
            attempts = 0;
            if (result === 'unsupported') {
              terminal = true;
              options.onUnsupported?.(true);
            }
          } catch (error) {
            if (!current()) return;
            if (error instanceof ContactContextCanceled) setState('waiting');
            else if (isStaleHydrationScopeError(error)) {
              terminal = true; // a generation/account lifecycle change must restart us
              setState('waiting');
            } else {
              setState('error');
              if (attempts < MAX_RETRIES) retryDelay = 1000 * 2 ** attempts++;
              else requested = false; // new source data/reconnection may wake it later
            }
          } finally {
            busy = false;
            if (retryDelay !== undefined) schedule(retryDelay);
            else if (requested) schedule();
          }
        };
        createEffect(
          on(options.source, (source) => {
            publisher?.replace(source);
            if (!source) {
              if (timer !== undefined) clearTimeout(timer);
              timer = undefined;
              requested = false;
              if (!terminal) setState('waiting');
              return;
            }
            schedule();
          })
        );
        onCleanup(
          onlineManager.subscribe((online) => {
            if (online && !terminal) {
              attempts = 0;
              schedule();
            }
          })
        );
        onCleanup(() => {
          disposed = true;
          if (timer !== undefined) clearTimeout(timer);
          publisher?.dispose();
        });
      }
    )
  );
  return state;
}
