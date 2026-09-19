import { match } from 'ts-pattern';
import { Document } from '../../entities/documents/document';
import { Project } from '../../entities/projects/project';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type DocumentEvent = Extract<
  MacroEvent,
  { event_type: `document.${string}` }
>;

/** Attach SDK entity handles to a document webhook event. */
export function hydrateDocumentEvent(
  client: MacroClient,
  event: DocumentEvent,
) {
  return match(event)
    .with({ event_type: 'document.created' }, ({ metadata }) => ({
      event_type: 'document.created' as const,
      metadata,
      document: Document.byId(client, metadata.document_id),
      owner: User.byId(client, metadata.owner),
      project: metadata.project_id
        ? Project.byId(client, metadata.project_id)
        : undefined,
    }))
    .with({ event_type: 'document.updated' }, ({ metadata }) => ({
      event_type: 'document.updated' as const,
      metadata,
      document: Document.byId(client, metadata.document_id),
      owner: User.byId(client, metadata.owner),
      actor: metadata.actor_user_id
        ? User.byId(client, metadata.actor_user_id)
        : undefined,
      project: metadata.project_id
        ? Project.byId(client, metadata.project_id)
        : undefined,
      previousProject: metadata.previous_project_id
        ? Project.byId(client, metadata.previous_project_id)
        : undefined,
    }))
    .with({ event_type: 'document.deleted' }, ({ metadata }) => ({
      event_type: 'document.deleted' as const,
      metadata,
      document: Document.byId(client, metadata.document_id),
      actor: metadata.actor_user_id
        ? User.byId(client, metadata.actor_user_id)
        : undefined,
      project: metadata.project_id
        ? Project.byId(client, metadata.project_id)
        : undefined,
    }))
    .with({ event_type: 'document.content_uploaded' }, ({ metadata }) => ({
      event_type: 'document.content_uploaded' as const,
      metadata,
      document: Document.byId(client, metadata.document_id),
      owner: User.byId(client, metadata.owner),
    }))
    .with({ event_type: 'document.sync_content_updated' }, ({ metadata }) => ({
      event_type: 'document.sync_content_updated' as const,
      metadata,
      document: Document.byId(client, metadata.document_id),
    }))
    .with({ event_type: 'document.purged' }, ({ metadata }) => ({
      event_type: 'document.purged' as const,
      metadata,
      document: Document.byId(client, metadata.document_id),
    }))
    .with({ event_type: 'document.copied' }, ({ metadata }) => ({
      event_type: 'document.copied' as const,
      metadata,
      document: Document.byId(client, metadata.document_id),
      sourceDocument: Document.byId(client, metadata.source_document_id),
      owner: User.byId(client, metadata.owner),
      project: metadata.project_id
        ? Project.byId(client, metadata.project_id)
        : undefined,
    }))
    .with({ event_type: 'document.interaction' }, ({ metadata }) => ({
      event_type: 'document.interaction' as const,
      metadata,
      document: Document.byId(client, metadata.document_id),
    }))
    .exhaustive();
}
