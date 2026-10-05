/** The `/forms` routes of `crates/forms`, mounted by the document storage service. */
import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  type FetchWithTokenInit,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import { statusError } from '@core/util/safeFetch';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import { errorBody } from './databases';
import type { CreateForm } from './generated/schemas/createForm';
import type { Form } from './generated/schemas/form';
import type { FormDetail } from './generated/schemas/formDetail';
import { FormErrorCode } from './generated/schemas/formErrorCode';
import type { FormErrorResponse } from './generated/schemas/formErrorResponse';
import type { FormLayout } from './generated/schemas/formLayout';
import type { FormTally } from './generated/schemas/formTally';
import type { LayoutProblem } from './generated/schemas/layoutProblem';
import type { ListedForm } from './generated/schemas/listedForm';
import type { MyResponse } from './generated/schemas/myResponse';
import type { ResponseSummary } from './generated/schemas/responseSummary';
import type { SharePermissionV2 } from './generated/schemas/sharePermissionV2';
import type { Submission } from './generated/schemas/submission';
import type { SubmissionOutcome } from './generated/schemas/submissionOutcome';
import type { UpdateForm } from './generated/schemas/updateForm';
import type { UpdateSharePermissionRequestV2 } from './generated/schemas/updateSharePermissionRequestV2';

/**
 * A `/forms` failure. A refusal the forms service explains carries its body:
 * the code, the question it names, and for a layout the problem.
 */
export type FormsError = ResultError<FetchWithTokenErrorCode> & {
  refusal: FormErrorResponse | null;
};

const documentStorageHost = SERVER_HOSTS['document-storage-service'];

const FORM_ERROR_CODES: readonly FormErrorCode[] = Object.values(FormErrorCode);

function isFormErrorCode(code: unknown): code is FormErrorCode {
  return FORM_ERROR_CODES.some((known) => known === code);
}

/** The forms service's own refusal body, when the response carries one. */
function formRefusalOf(body: unknown): FormErrorResponse | null {
  if (!body || typeof body !== 'object') return null;
  if (!('code' in body) || !isFormErrorCode(body.code)) return null;
  if (!('message' in body) || typeof body.message !== 'string') return null;
  const question =
    'question' in body && typeof body.question === 'string'
      ? body.question
      : null;
  const problem = 'problem' in body ? layoutProblemOf(body.problem) : null;
  return { code: body.code, message: body.message, question, problem };
}

/** What a refused layout names; an unrecognised problem reads as none. */
function layoutProblemOf(value: unknown): LayoutProblem | null {
  if (!value || typeof value !== 'object' || !('kind' in value)) return null;
  const text = (key: string) =>
    key in value && typeof Reflect.get(value, key) === 'string'
      ? String(Reflect.get(value, key))
      : undefined;
  const column = text('column');
  const id = text('id');
  const reason = text('reason');
  const max =
    'max' in value && typeof value.max === 'number' ? value.max : undefined;
  return match(value.kind)
    .returnType<LayoutProblem | null>()
    .with(
      'unknownColumn',
      'managedColumn',
      'repeatedColumn',
      'gateNamesLaterColumn',
      (kind) => (column ? { kind, column } : null)
    )
    .with('repeatedId', (kind) => (id ? { kind, id } : null))
    .with('gateRule', (kind) => (reason ? { kind, reason } : null))
    .with('textTooLong', (kind) => (max !== undefined ? { kind, max } : null))
    .otherwise(() => null);
}

/** One `/forms` request; a failure carries the service's message and refusal. */
function formsFetch<Data extends ObjectLike>(
  path: string,
  init: Omit<FetchWithTokenInit, 'errorResponseHandler'> = {}
): ResultAsync<Data, FormsError[]> {
  return new ResultAsync(
    fetchWithToken<Data>(`${documentStorageHost}${path}`, {
      ...init,
      errorResponseHandler: async (response) => {
        const { body, message } = await errorBody(response);
        return {
          ...statusError(response.status),
          message,
          refusal: formRefusalOf(body),
        };
      },
    })
  ).mapErr((errors) =>
    errors.map((error) => ({
      ...error,
      refusal: 'refusal' in error ? formRefusalOf(error.refusal) : null,
    }))
  );
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const formsClient = {
  create(request: CreateForm) {
    return formsFetch<FormDetail>('/forms', {
      method: 'POST',
      ...json(request),
    });
  },

  /** Every form shared with the caller (directly, by team or channel), for Drive and Quick Access. */
  listAccessible() {
    return formsFetch<ListedForm[]>('/forms/accessible');
  },

  /** The live forms over one database, for its "Forms" chip. */
  listForDatabase({ databaseId }: { databaseId: string }) {
    return formsFetch<Form[]>(
      `/forms?databaseId=${encodeURIComponent(databaseId)}`
    );
  },

  get({ id }: { id: string }) {
    return formsFetch<FormDetail>(`/forms/${id}`);
  },

  update({ id, request }: { id: string; request: UpdateForm }) {
    return formsFetch<Form>(`/forms/${id}`, {
      method: 'PATCH',
      ...json(request),
    });
  },

  /** Replace the sections and questions as one document. */
  putLayout({ id, layout }: { id: string; layout: FormLayout }) {
    return formsFetch<FormDetail>(`/forms/${id}/layout`, {
      method: 'PUT',
      ...json(layout),
    });
  },

  submit({ id, submission }: { id: string; submission: Submission }) {
    return formsFetch<SubmissionOutcome>(`/forms/${id}/responses`, {
      method: 'POST',
      ...json(submission),
    });
  },

  getMyResponse({ id }: { id: string }) {
    return formsFetch<MyResponse>(`/forms/${id}/responses/mine`);
  },

  editMyResponse({ id, submission }: { id: string; submission: Submission }) {
    return formsFetch<SubmissionOutcome>(`/forms/${id}/responses/mine`, {
      method: 'PUT',
      ...json(submission),
    });
  },

  getSummary({ id }: { id: string }) {
    return formsFetch<ResponseSummary>(`/forms/${id}/responses/summary`);
  },

  getTally({ id }: { id: string }) {
    return formsFetch<FormTally>(`/forms/${id}/tally`);
  },

  getPermissions({ id }: { id: string }) {
    return formsFetch<SharePermissionV2>(`/forms/${id}/permissions`);
  },

  updatePermissions({
    id,
    ...request
  }: { id: string } & UpdateSharePermissionRequestV2) {
    return formsFetch<SharePermissionV2>(`/forms/${id}/permissions`, {
      method: 'PATCH',
      ...json(request),
    });
  },
};
