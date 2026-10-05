/** Adapters from the shared form and database queries to the feature's sources. */
import { ThrownResultError } from '@core/util/result';
import {
  updateForm,
  useFormDetailQuery,
  useResponseSummaryQuery,
} from '@queries/storage/forms';
import {
  useFormChangedSync,
  useFormDatabaseSync,
  useFormResponsesSync,
} from '@queries/storage/forms-sync';
import type { FormsError } from '@service-storage/forms';
import type { FormErrorCode } from '@service-storage/generated/schemas/formErrorCode';
import type { ResultAsync } from 'neverthrow';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  FormDetailSource,
  FormLoadFailure,
  FormMetadataPatch,
  FormRefusal,
  FormWriteFailure,
  ReadSource,
} from '../context/form-context';
import type { ResponseCounts } from '../core/response-stats';
import { toFormDetail } from './form-detail';

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

export function updateFormMetadata(
  formId: string,
  patch: FormMetadataPatch
): ResultAsync<void, FormWriteFailure> {
  return updateForm(formId, patch)
    .map(() => undefined)
    .mapErr(writeFailureOf);
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
