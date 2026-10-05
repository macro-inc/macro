/**
 * The shared layout's production wiring: the forms service seeds and
 * publishes it (`POST /forms/{id}/collaboration`), the sync service carries
 * it on the collab surface the form owns, under the form's own id.
 */
import { getCollabSurfaceToken } from '@core/collab-surface/token';
import { collaborateOnForm } from '@queries/storage/forms';
import type { FormCollaboration } from '@service-storage/generated/schemas/formCollaboration';
import { createCollabSurfaceSource } from '@service-sync/source';
import { ResultAsync } from 'neverthrow';
import { createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  FormLayoutCollaboration,
  FormLayoutSave,
  FormWriteFailure,
} from '../context/form-context';
import {
  createFormCollaborationSession,
  FormFlushError,
} from './form-collaboration';
import { toFormLayout, toLayoutDocument } from './form-detail';

/**
 * Opens the form's shared layout, seeding it from the published one the
 * first time, or publishes what it holds. The detail it answers seeds the
 * form's cache.
 */
async function collaborate(formId: string): Promise<FormCollaboration> {
  const result = await collaborateOnForm(formId);
  if (result.isErr())
    throw new Error(
      result.error[0]?.message ?? 'The form couldn’t be opened for editing.'
    );
  return result.value;
}

/** Why the layout isn't published yet, in words the builder shows. */
export function flushFailureOf(error: unknown): FormWriteFailure {
  if (!(error instanceof FormFlushError))
    return {
      message:
        error instanceof Error ? error.message : 'The form couldn’t be saved.',
    };
  return match(error.failure)
    .returnType<FormWriteFailure>()
    .with({ kind: 'not-ready' }, () => ({
      message: 'The form isn’t open for editing yet.',
    }))
    .with({ kind: 'offline' }, () => ({
      message: 'You’re offline. Your changes are kept on this device.',
    }))
    .with({ kind: 'unsaved' }, () => ({
      message:
        'Some changes haven’t reached the server yet. They’re kept on this device.',
    }))
    .with({ kind: 'storage' }, () => ({
      message:
        'Your changes couldn’t be stored on this device. Keep this tab open until they’re saved.',
    }))
    .with({ kind: 'publication' }, ({ message }) => ({
      message: `Respondents still see the last valid version of this form. ${message}`,
      refusal: 'invalid-layout',
    }))
    .with({ kind: 'publish-failed' }, () => ({
      message: 'The form couldn’t be published. Try again.',
    }))
    .exhaustive();
}

/** The form's shared layout for an editor; call under the editor's owner. */
export function createFormLayoutCollaboration(
  formId: string,
  userId: string | undefined
): FormLayoutCollaboration {
  let token: string | undefined;
  const session = createFormCollaborationSession({
    formId,
    userId,
    initialize: async () => {
      await collaborate(formId);
      // Editors only: the surface token checks the form's own access.
      token = await getCollabSurfaceToken(formId);
      if (!token) throw new Error('This form’s editing session was refused.');
    },
    publish: async () => {
      const published = await collaborate(formId);
      return { publicationError: published.publicationError };
    },
    connect: () => {
      if (!token) throw new Error('This form’s editing session was refused.');
      return createCollabSurfaceSource(formId, token, () =>
        getCollabSurfaceToken(formId)
      );
    },
  });
  const layout = createMemo(() => {
    const document = session.layout();
    return document && toFormLayout(document);
  });
  return {
    status: session.state,
    layout,
    save: () =>
      match(session.save())
        .returnType<FormLayoutSave>()
        .with({ kind: 'unsaved', reason: 'storage' }, () => 'unstored')
        .with({ kind: 'unsaved', reason: 'undelivered' }, () => 'unsaved')
        .with({ kind: 'saving' }, () => 'saving')
        .with({ kind: 'saved' }, () => 'saved')
        .exhaustive(),
    connection: session.connection,
    apply: (previous, next) =>
      session.apply(toLayoutDocument(previous), toLayoutDocument(next)),
    flush: () => ResultAsync.fromPromise(session.flush(), flushFailureOf),
    publicationError: session.publicationError,
    peers: session.peers,
    select: session.setSelection,
  };
}
