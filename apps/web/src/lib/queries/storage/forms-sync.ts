/** Gateway liveness for forms, apart from `./forms` to keep the websocket out of startup. */
import { useEntitySubscription } from '@service-connection/client';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import type { Accessor } from 'solid-js';
import { z } from 'zod';
import { queryClient } from '../client';
import { invalidatePreview } from '../preview';
import { invalidateDatabase } from './databases';
import {
  parseMessageData,
  useDatabaseMetadataChanges,
  useDatabaseTableChanges,
} from './databases-sync';
import { formsKeys, myResponseKeyOf } from './keys';

/** The forms service pings `form:<id>` after a layout, fact or response write. */
const FORM_CHANGED_MESSAGE_TYPE = 'form_changed';
const formChangedSchema = z.object({ formId: z.string() });

/**
 * Subscribe only while viewing an editable form in its editor. Gateway
 * subscriptions also announce presence, so respondent surfaces refresh through
 * their query instead. Never subscribes to the form's database.
 */
export function useFormChangedSync(formId: Accessor<string | undefined>) {
  useEntitySubscription(() => {
    const id = formId();
    return id ? { entity_type: 'form', entity_id: id } : undefined;
  });
  createConnectionWebsocketEffect((message) => {
    if (message.type !== FORM_CHANGED_MESSAGE_TYPE) return;
    const changed = parseMessageData(message, formChangedSchema);
    const id = formId();
    if (!changed || !id || changed.formId !== id) return;
    void invalidatePreview(id);
    for (const key of [
      formsKeys.detail(id).queryKey,
      formsKeys.summary(id).queryKey,
      formsKeys.tally(id).queryKey,
      myResponseKeyOf(id),
    ])
      void queryClient.invalidateQueries({ queryKey: key });
  });
}

/**
 * Editors only: track the form's database so its table events arrive, and
 * re-read its schema. Respondents never track it; database events carry
 * other viewers' positions.
 */
export function useFormDatabaseSync(
  databaseId: Accessor<string | undefined>,
  isEditor: Accessor<boolean>,
  formId: Accessor<string | undefined>
) {
  useEntitySubscription(
    () => {
      const id = databaseId();
      return id && isEditor()
        ? { entity_type: 'database', entity_id: id }
        : undefined;
    },
    (entity) => void invalidateDatabase(entity.entity_id)
  );
  useDatabaseMetadataChanges((change) => {
    if (!isEditor() || change.databaseId !== databaseId()) return;
    void invalidateDatabase(change.databaseId);
    const id = formId();
    if (id) void invalidatePreview(id);
  });
}

/**
 * Keep a form's counts and tally fresh: every write to its database's table
 * (a response, a grid edit) pings `database_table_changed`.
 */
export function useFormResponsesSync(
  formId: Accessor<string | undefined>,
  databaseId: Accessor<string | undefined>
) {
  useDatabaseTableChanges((change) => {
    const id = formId();
    if (!id || change.databaseId !== databaseId()) return;
    void queryClient.invalidateQueries({
      queryKey: formsKeys.summary(id).queryKey,
    });
    void queryClient.invalidateQueries({
      queryKey: formsKeys.tally(id).queryKey,
    });
  });
}
