import {
  ThrownResultError,
  thrownResultErrorHasCode,
  throwOnErr,
} from '@core/util/result';
import { queryClient } from '@queries/client';
import { documentLoadKeys } from '@queries/storage/documentLoad/keys';
import { fetchFileDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';
import { syncServiceClient } from '@service-sync/client';
import { createSyncServiceSource } from '@service-sync/source';
import type { DocumentSyncAuthorization } from '@service-sync/source/authorization';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import type { CanvasSessionOptions } from './canvas-session';

export function canvasSyncSource(
  documentId: string,
  userId: Accessor<string | undefined>
): Pick<
  CanvasSessionOptions,
  'exists' | 'initialize' | 'connect' | 'authorize'
> & { canWrite: Accessor<boolean> } {
  let authorization: DocumentSyncAuthorization | undefined;
  let token: string | undefined;
  let authorized = false;
  const openedBy = userId();
  let invalidated = false;
  const listeners = new Set<() => void>();
  const [canWrite, setCanWrite] = createSignal(true);
  createEffect(
    on(userId, (currentUser) => {
      if (currentUser === openedBy) return;
      invalidated = true;
      setCanWrite(false);
      for (const listener of listeners) listener();
    })
  );
  return {
    canWrite,
    async authorize() {
      const load = async (refresh = false) => {
        try {
          if (refresh)
            await queryClient.invalidateQueries({
              queryKey: documentLoadKeys.bundle(documentId).queryKey,
              exact: true,
              refetchType: 'none',
            });
          return await throwOnErr(() =>
            fetchFileDocumentOpenContext(documentId)
          );
        } catch (cause) {
          if (
            // The block loader also maps transient network failures to INVALID.
            // Preserve local editing until a fresh grant or confirmed denial.
            ['FORBIDDEN', 'NOT_FOUND', 'MISSING', 'GONE'].some((code) =>
              thrownResultErrorHasCode(cause, code)
            )
          )
            setCanWrite(false);
          throw cause;
        }
      };
      const context = await load();
      let editable =
        context.userAccessLevel === 'owner' ||
        context.userAccessLevel === 'edit';
      setCanWrite(editable);
      token = context.token;
      const captured = context.authorization;
      const current = () =>
        !invalidated &&
        userId() === openedBy &&
        (captured?.isCurrent() ?? true);
      let first: typeof context | undefined = context;
      authorization = {
        isCurrent: current,
        canWrite: () => current() && editable && (captured?.canWrite() ?? true),
        async getToken() {
          if (!current()) throw new Error('Canvas session changed.');
          let value: string | undefined;
          if (captured) value = await captured.getToken();
          else {
            const fresh = first ?? (await load(true));
            first = undefined;
            editable =
              fresh.userAccessLevel === 'owner' ||
              fresh.userAccessLevel === 'edit';
            value = fresh.token;
          }
          if (!value)
            throw new Error('Canvas authorization returned no token.');
          if (!current()) throw new Error('Canvas session changed.');
          setCanWrite(editable && (captured?.canWrite() ?? true));
          return value;
        },
        onInvalidated(listener) {
          listeners.add(listener);
          const stop = captured?.onInvalidated(() => {
            setCanWrite(false);
            listener();
          });
          if (invalidated || userId() !== openedBy) listener();
          return () => {
            listeners.delete(listener);
            stop?.();
          };
        },
      };
      setCanWrite(authorization.canWrite());
      authorized = true;
    },
    async exists() {
      const result = await syncServiceClient.exists({ documentId });
      if (result.isErr()) throw new ThrownResultError(result.error);
      return result.value.exists;
    },
    async initialize(snapshot) {
      if (
        !authorization ||
        !authorization.isCurrent() ||
        !authorization.canWrite()
      )
        throw new ThrownResultError([
          {
            code: 'FORBIDDEN',
            message: 'Canvas editing is no longer authorized.',
          },
        ]);
      await throwOnErr(() =>
        syncServiceClient.initializeFromSnapshot({
          documentId,
          snapshot,
        })
      );
    },
    connect: () => {
      if (!authorized)
        throw new Error('Canvas synchronization requires authorization.');
      return createSyncServiceSource(documentId, token, authorization);
    },
  };
}
