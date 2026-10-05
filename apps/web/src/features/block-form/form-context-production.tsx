/**
 * Production wiring for Macro Forms: the real query adapters, toasts and
 * dialogs. Only the app-facing entry points import this; views and
 * primitives read the contract from `context/form-context`.
 */
import { toast } from '@core/component/Toast/Toast';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import { confirmDialog } from '@ui';
import type { FormContext } from './context/form-context';
import { trashForm } from './queries/form-entity';
import {
  createFormDetailSource,
  createSummarySource,
  updateFormMetadata,
} from './queries/form-sources';

/** The production capabilities, built under the mounting owner. */
export function createAppFormContext(): FormContext {
  return {
    createFormSource: createFormDetailSource,
    updateMetadata: updateFormMetadata,
    trashForm: (formId) => trashForm(getEntityGraphqlClient(), formId),
    confirm: (question) =>
      confirmDialog({
        title: question.title,
        body: question.body,
        confirmLabel: question.confirmLabel,
        tone: question.tone,
      }),
    responses: {
      createSummary: createSummarySource,
    },
    notify: {
      success: (message) => toast.success(message),
      failure: (message) => toast.failure(message),
    },
  };
}
