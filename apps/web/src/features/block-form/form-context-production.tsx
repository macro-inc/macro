/**
 * Production wiring for Macro Forms: the real query adapters, the app's
 * pickers, the database grid and condition editor, toasts and dialogs. Only
 * the app-facing entry points import this; views and primitives read the
 * contract from `context/form-context`.
 */
import type { DatabaseRelatedDestination } from '@block-database/core/database-relations';
import { DatabaseMentionValue } from '@block-database/database-mentions';
import { exportDatabaseTableCsv } from '@block-database/queries/transfer';
import { toast } from '@core/component/Toast/Toast';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { useUserId } from '@core/context/user';
import { uploadFile } from '@core/util/upload';
import { downloadFile } from '@filesystem/download';
import { queryClient } from '@queries/client';
import { databaseDetailQueryOptions } from '@queries/storage/databases';
import { useDatabaseTableChanges } from '@queries/storage/databases-sync';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import { confirmDialog } from '@ui';
import { errAsync, ResultAsync } from 'neverthrow';
import type { FormContext, FormWriteFailure } from './context/form-context';
import { FormConditionEditor } from './form-condition-editor';
import { FormEntityPicker, FormRelationPicker } from './form-pickers';
import { FormResponsesGrid } from './form-responses-grid';
import { createColumnWrites } from './queries/column-writes';
import { directMessageWith } from './queries/direct-message';
import { renameForm, trashForm } from './queries/form-entity';
import {
  createFormDetailSource,
  createFormTableSource,
  createInvitedSource,
  createMyResponseSource,
  createSummarySource,
  createTallySource,
  editMyFormResponse,
  saveFormLayout,
  submitFormResponse,
  updateFormMetadata,
} from './queries/form-sources';

/** Download a table as the grid's own CSV export writes it. */
function exportTableCsv(
  databaseId: string,
  tableId: string
): ResultAsync<void, FormWriteFailure> {
  return ResultAsync.fromPromise(
    queryClient.fetchQuery(databaseDetailQueryOptions(databaseId)),
    (): FormWriteFailure => ({ message: 'The database couldn’t be read.' })
  ).andThen((detail) => {
    const table = detail.tables.find((entry) => entry.table.id === tableId);
    if (!table)
      return errAsync<void, FormWriteFailure>({
        message: 'This form’s table no longer exists.',
      });
    return exportDatabaseTableCsv(detail, table)
      .mapErr(
        (failure): FormWriteFailure => ({
          message:
            failure.kind === 'too-large'
              ? 'This table is too large for CSV export.'
              : 'Could not export this table.',
        })
      )
      .andThen((blob) =>
        ResultAsync.fromPromise(
          downloadFile(blob, `${table.table.name}.csv`),
          (): FormWriteFailure => ({ message: 'The download failed.' })
        )
      )
      .map(() => undefined);
  });
}

function uploadStaticFile(file: File): ResultAsync<string, FormWriteFailure> {
  const uploaded = async () => {
    const result = await uploadFile(file, 'static');
    if (result.failed) throw result.error;
    return staticFileIdEndpoint(result.id);
  };
  return ResultAsync.fromPromise(uploaded(), (error) => ({
    message: error instanceof Error ? error.message : 'The upload failed.',
  }));
}

export type FormHostActions = {
  openRelated: (destination: DatabaseRelatedDestination) => void;
  /** Show a channel, e.g. the direct conversation with a form's owner. */
  openChannel: (channelId: string) => void;
};

/** The production capabilities, built under the mounting owner. */
export function createAppFormContext(host: FormHostActions): FormContext {
  const userId = useUserId();
  return {
    viewer: { userId },
    createFormSource: createFormDetailSource,
    createTableSource: createFormTableSource,
    followTable: (databaseId, onChange) =>
      useDatabaseTableChanges((change) => {
        if (change.databaseId === databaseId()) onChange();
      }),
    saveLayout: saveFormLayout,
    updateMetadata: updateFormMetadata,
    renameForm: (formId, name) =>
      renameForm(getEntityGraphqlClient(), formId, name),
    trashForm: (formId) => trashForm(getEntityGraphqlClient(), formId),
    confirm: (question) =>
      confirmDialog({
        title: question.title,
        body: question.body,
        confirmLabel: question.confirmLabel,
        tone: question.tone,
      }),
    columns: createColumnWrites,
    responses: {
      submit: submitFormResponse,
      editMine: editMyFormResponse,
      createMine: (formId) => createMyResponseSource(formId, userId),
      createSummary: createSummarySource,
      createTally: createTallySource,
      createInvited: createInvitedSource,
      exportCsv: exportTableCsv,
    },
    uploadFile: uploadStaticFile,
    messageOwner: (ownerId) => directMessageWith(ownerId).map(host.openChannel),
    notify: {
      success: (message) => toast.success(message),
      failure: (message) => toast.failure(message),
    },
    ui: {
      renderEntityPicker: (props) => <FormEntityPicker {...props} />,
      renderRelationPicker: (props) => <FormRelationPicker {...props} />,
      renderConditionEditor: (props) => <FormConditionEditor {...props} />,
      renderResponsesGrid: (props) => (
        <FormResponsesGrid
          databaseId={props.databaseId}
          tableId={props.tableId}
          onOpenRelated={host.openRelated}
        />
      ),
      renderEntityLabel: (entity) => (
        <DatabaseMentionValue
          id={entity.entityId}
          entityType={entity.entityType}
        />
      ),
    },
  };
}
