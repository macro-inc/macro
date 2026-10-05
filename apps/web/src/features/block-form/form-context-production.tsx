/**
 * Production wiring for Macro Forms: the real query adapters, the grid's
 * condition editor, toasts and dialogs. Only the app-facing entry points
 * import this; views and primitives read the contract from
 * `context/form-context`.
 */
import { toast } from '@core/component/Toast/Toast';
import { useDatabaseTableChanges } from '@queries/storage/databases-sync';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import { confirmDialog } from '@ui';
import type { FormContext } from './context/form-context';
import { FormConditionEditor } from './form-condition-editor';
import { createColumnWrites } from './queries/column-writes';
import { renameForm, trashForm } from './queries/form-entity';
import {
  createFormDetailSource,
  createFormTableSource,
  createSummarySource,
  saveFormLayout,
  updateFormMetadata,
} from './queries/form-sources';

/** The production capabilities, built under the mounting owner. */
export function createAppFormContext(): FormContext {
  return {
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
      createSummary: createSummarySource,
    },
    notify: {
      success: (message) => toast.success(message),
      failure: (message) => toast.failure(message),
    },
    ui: {
      renderConditionEditor: (props) => <FormConditionEditor {...props} />,
    },
  };
}
