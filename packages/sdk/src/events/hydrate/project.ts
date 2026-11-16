import { match } from 'ts-pattern';
import { Project } from '../../entities/projects/project';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type ProjectEvent = Extract<
  MacroEvent,
  { event_type: `project.${string}` }
>;

/** Attach project, parent and actor handles to a project event. */
export function hydrateProjectEvent(client: MacroClient, event: ProjectEvent) {
  const parent = (id: string | null | undefined) =>
    id ? Project.byId(client, id) : undefined;
  const actor = (id: string | null | undefined) =>
    id ? User.byId(client, id) : undefined;

  return match(event)
    .with({ event_type: 'project.created' }, ({ metadata }) => ({
      event_type: 'project.created' as const,
      metadata,
      project: Project.byId(client, metadata.project_id),
      parent: parent(metadata.parent_project_id),
    }))
    .with({ event_type: 'project.updated' }, ({ metadata }) => ({
      event_type: 'project.updated' as const,
      metadata,
      project: Project.byId(client, metadata.project_id),
      actor: actor(metadata.actor_user_id),
    }))
    .with(
      { event_type: 'project.deleted' },
      { event_type: 'project.restored' },
      { event_type: 'project.permanently_deleted' },
      { event_type: 'project.uploaded' },
      ({ event_type, metadata }) => ({
        event_type,
        metadata,
        project: Project.byId(client, metadata.project_id),
        parent: parent(metadata.parent_project_id),
        actor: actor(metadata.actor_user_id),
      }),
    )
    .exhaustive((unknown) => {
      console.warn('macro sdk: unknown project event', unknown);
      return undefined;
    });
}
