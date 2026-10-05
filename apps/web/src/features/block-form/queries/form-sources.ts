/** Adapters from the shared form and database queries to the feature's sources. */
import { ThrownResultError } from '@core/util/result';
import { useDatabaseDetailQuery } from '@queries/storage/databases';
import {
  editMyResponse,
  putFormLayout,
  submitResponse,
  updateForm,
  useFormDetailQuery,
  useFormInvitedCount,
  useMyResponseQuery,
  useResponseSummaryQuery,
  useTallyQuery,
} from '@queries/storage/forms';
import {
  useFormChangedSync,
  useFormDatabaseSync,
  useFormResponsesSync,
} from '@queries/storage/forms-sync';
import type { FormsError } from '@service-storage/forms';
import type { FormErrorCode } from '@service-storage/generated/schemas/formErrorCode';
import type { MyResponse as WireMyResponse } from '@service-storage/generated/schemas/myResponse';
import type { SubmissionOutcome } from '@service-storage/generated/schemas/submissionOutcome';
import type { ResultAsync } from 'neverthrow';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  FormDetailSource,
  FormLoadFailure,
  FormMetadataPatch,
  FormRefusal,
  FormTableSource,
  FormWriteFailure,
  MyResponseSource,
  QuestionTally,
  ReadSource,
  SubmitOutcome,
} from '../context/form-context';
import type { SubmittedAnswer } from '../core/answers';
import type { FormDetail, FormLayout } from '../core/form-model';
import type { ResponseCounts } from '../core/response-stats';
import { toFormDetail, toLayoutDocument } from './form-detail';
import { toFormColumn } from './table-columns';

function isFormsError(error: unknown): error is FormsError {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    'refusal' in error
  );
}

/** The errors a failed form read threw. */
function formsErrorsOf(error: unknown): FormsError[] {
  if (error instanceof ThrownResultError)
    return error.errors.filter(isFormsError);
  return [];
}

/** Why a read failed, from the errors its query threw. */
export function loadFailureOf(error: unknown): FormLoadFailure {
  const [first] = formsErrorsOf(error);
  const refusal = first?.refusal?.code;
  if (refusal === 'notFound' || first?.code === 'NOT_FOUND')
    return { kind: 'not-found' };
  if (refusal === 'signInRequired' || first?.code === 'UNAUTHORIZED')
    return { kind: 'sign-in' };
  if (refusal === 'forbidden' || first?.code === 'FORBIDDEN')
    return { kind: 'forbidden' };
  return {
    kind: 'failed',
    message:
      first?.message ??
      (error instanceof Error ? error.message : 'Unknown error'),
  };
}

/** The service's refusal code in the feature's words; a new code fails to compile here. */
function refusalOf(code: FormErrorCode): FormRefusal {
  return match(code)
    .returnType<FormRefusal>()
    .with('notFound', () => 'not-found')
    .with('forbidden', () => 'forbidden')
    .with('ownerOnly', () => 'owner-only')
    .with('signInRequired', () => 'sign-in-required')
    .with('closed', () => 'closed')
    .with('tableGone', () => 'table-gone')
    .with('alreadyResponded', () => 'already-responded')
    .with('noResponse', () => 'no-response')
    .with('unknownQuestion', () => 'unknown-question')
    .with('repeatedAnswer', () => 'repeated-answer')
    .with('missingAnswer', () => 'missing-answer')
    .with('invalidAnswer', () => 'invalid-answer')
    .with('widgetMismatch', () => 'widget-mismatch')
    .with('fileUploadNeedsSignIn', () => 'file-upload-needs-sign-in')
    .with('invalidLayout', () => 'invalid-layout')
    .with('invalidName', () => 'invalid-name')
    .with('invalidSharing', () => 'invalid-sharing')
    .with('tallyHidden', () => 'tally-hidden')
    .with('conflict', () => 'conflict')
    .with('internal', () => 'internal')
    .exhaustive();
}

/** A refused write in the words the UI shows, naming the question it refused. */
export function writeFailureOf(errors: FormsError[]): FormWriteFailure {
  const [first] = errors;
  if (!first) return { message: 'Something went wrong. Try again.' };
  const refusal = first.refusal;
  return {
    message: refusal?.message ?? first.message,
    refusal: refusal ? refusalOf(refusal.code) : undefined,
    questionId: refusal?.question ?? undefined,
  };
}

export function createFormDetailSource(
  formId: Accessor<string>
): FormDetailSource {
  const query = useFormDetailQuery(formId);
  const detail = createMemo(() =>
    query.isSuccess ? toFormDetail(query.data) : undefined
  );
  // Once per mounted form: everyone hears form pings; only editors track the
  // database, whose events carry other viewers' positions.
  const databaseId = () => detail()?.form.databaseId;
  useFormChangedSync(formId);
  useFormDatabaseSync(databaseId, () => {
    const access = detail()?.access;
    return access === 'edit' || access === 'owner';
  });
  useFormResponsesSync(formId, databaseId);
  return {
    detail,
    failure: () => (query.isError ? loadFailureOf(query.error) : undefined),
    refetch: async () => {
      const read = await query.refetch();
      return !read.isError;
    },
  };
}

export function createFormTableSource(
  databaseId: Accessor<string | undefined>,
  tableId: Accessor<string | undefined>
): FormTableSource {
  const query = useDatabaseDetailQuery(databaseId);
  const table = () =>
    query.isSuccess
      ? query.data.tables.find((entry) => entry.table.id === tableId())
      : undefined;
  const columns = createMemo(() => {
    const found = table();
    return found
      ? found.columns.flatMap((column) => {
          const projected = toFormColumn(column);
          return projected ? [projected] : [];
        })
      : undefined;
  });
  return {
    columns,
    databaseName: () =>
      query.isSuccess ? query.data.database.name : undefined,
    tableName: () => table()?.table.name,
    tables: () =>
      query.isSuccess
        ? query.data.tables.map((entry) => ({
            id: entry.table.id,
            name: entry.table.name,
          }))
        : [],
    refetch: async () => {
      await query.refetch();
    },
  };
}

export function saveFormLayout(
  formId: string,
  layout: FormLayout
): ResultAsync<FormDetail, FormWriteFailure> {
  return putFormLayout(formId, toLayoutDocument(layout))
    .map(toFormDetail)
    .mapErr(writeFailureOf);
}

export function updateFormMetadata(
  formId: string,
  patch: FormMetadataPatch
): ResultAsync<void, FormWriteFailure> {
  return updateForm(formId, patch)
    .map(() => undefined)
    .mapErr(writeFailureOf);
}

function toSubmitOutcome(outcome: SubmissionOutcome): SubmitOutcome {
  return match(outcome)
    .returnType<SubmitOutcome>()
    .with({ outcome: 'submitted' }, ({ response }) => ({
      kind: 'submitted',
      responseId: response,
    }))
    .with({ outcome: 'stopped' }, ({ section, message }) => ({
      kind: 'stopped',
      sectionId: section,
      message,
    }))
    .exhaustive();
}

export function submitFormResponse(
  formId: string,
  answers: SubmittedAnswer[]
): ResultAsync<SubmitOutcome, FormWriteFailure> {
  return submitResponse(formId, { answers })
    .map(toSubmitOutcome)
    .mapErr(writeFailureOf);
}

export function editMyFormResponse(
  formId: string,
  answers: SubmittedAnswer[]
): ResultAsync<SubmitOutcome, FormWriteFailure> {
  return editMyResponse(formId, { answers })
    .map(toSubmitOutcome)
    .mapErr(writeFailureOf);
}

function toMyResponse(mine: WireMyResponse) {
  return {
    status: mine.response.status,
    submittedAt: mine.response.submittedAt,
    answers: mine.answers,
  };
}

export function createMyResponseSource(
  formId: Accessor<string>,
  userId: Accessor<string | undefined>
): MyResponseSource {
  const query = useMyResponseQuery(formId, userId);
  return {
    response: () => {
      if (!userId()) return null;
      if (!query.isSuccess) return undefined;
      return query.data ? toMyResponse(query.data) : null;
    },
    failure: () => (query.isError ? loadFailureOf(query.error) : undefined),
    refetch: async () => {
      await query.refetch();
    },
  };
}

export function createSummarySource(
  formId: Accessor<string>,
  enabled: Accessor<boolean>
): ReadSource<ResponseCounts> {
  const query = useResponseSummaryQuery(formId, enabled);
  return {
    value: () =>
      query.isSuccess
        ? {
            submitted: query.data.submitted,
            stopped: query.data.stopped,
            stoppedBySection: query.data.stoppedBySection.map((entry) => ({
              sectionId: entry.section,
              count: entry.count,
            })),
            rows: query.data.rows,
          }
        : undefined,
    failure: () => (query.isError ? loadFailureOf(query.error) : undefined),
  };
}

export function createTallySource(
  formId: Accessor<string>,
  enabled: Accessor<boolean>
): ReadSource<QuestionTally[]> {
  const query = useTallyQuery(() => formId() || undefined, enabled);
  return {
    value: () =>
      query.isSuccess
        ? query.data.questions.map((question) => ({
            questionId: question.question,
            responses: question.responses,
            buckets: question.buckets.map((bucket) =>
              match(bucket.value)
                .returnType<QuestionTally['buckets'][number]>()
                .with({ kind: 'option' }, ({ option }) => ({
                  kind: 'option',
                  optionId: option,
                  count: bucket.count,
                }))
                .with({ kind: 'checkbox' }, ({ checked }) => ({
                  kind: 'checkbox',
                  checked,
                  count: bucket.count,
                }))
                .exhaustive()
            ),
          }))
        : undefined,
    failure: () => (query.isError ? loadFailureOf(query.error) : undefined),
  };
}

export function createInvitedSource(
  formId: Accessor<string>,
  ownerId: Accessor<string>,
  enabled: Accessor<boolean>
): ReadSource<number | null> {
  const invited = useFormInvitedCount(
    () => formId() || undefined,
    ownerId,
    enabled
  );
  return {
    value: invited.count,
    failure: () => {
      const error = invited.error();
      return error ? loadFailureOf(error) : undefined;
    },
  };
}
