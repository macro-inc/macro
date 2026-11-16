import { match } from 'ts-pattern';
import { Database } from '../../entities/databases/database';
import { Form } from '../../entities/forms/form';
import { User } from '../../entities/users/user';
import type { MacroClient } from '../../utils/client';
import type { MacroEvent } from '../types';

export type FormEvent = Extract<MacroEvent, { event_type: `form.${string}` }>;

/** Attach form, database and acted-for user handles to a form event. */
export function hydrateFormEvent(client: MacroClient, event: FormEvent) {
  const handles = (change: {
    form_id: string;
    on_behalf_of?: string | null;
  }) => ({
    form: Form.byId(client, change.form_id),
    onBehalfOf: change.on_behalf_of
      ? User.byId(client, change.on_behalf_of)
      : undefined,
  });

  return match(event)
    .with({ event_type: 'form.created' }, ({ metadata }) => ({
      event_type: 'form.created' as const,
      metadata,
      ...handles(metadata),
      database: Database.byId(client, metadata.database_id),
    }))
    .with(
      { event_type: 'form.renamed' },
      { event_type: 'form.trashed' },
      { event_type: 'form.restored' },
      { event_type: 'form.sharing_changed' },
      { event_type: 'form.appearance_changed' },
      ({ event_type, metadata }) => ({
        event_type,
        metadata,
        ...handles(metadata),
      }),
    )
    .with({ event_type: 'form.response_submitted' }, ({ metadata }) => ({
      event_type: 'form.response_submitted' as const,
      metadata,
      form: Form.byId(client, metadata.form_id),
    }))
    .exhaustive((unknown) => {
      console.warn('macro sdk: unknown form event', unknown);
      return undefined;
    });
}
