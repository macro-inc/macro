import type { ResultAsync } from 'neverthrow';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { FormAudience, FormDetail, FormStatus } from '../core/form-model';
import type { ResponseCounts } from '../core/response-stats';

/** Why a form could not be read. */
export type FormLoadFailure =
  | { kind: 'not-found' }
  | { kind: 'sign-in' }
  | { kind: 'forbidden' }
  | { kind: 'failed'; message: string };

/** Why the forms service refused a request, in the feature's own words. */
export type FormRefusal =
  | 'not-found'
  | 'forbidden'
  | 'owner-only'
  | 'sign-in-required'
  | 'closed'
  | 'table-gone'
  | 'already-responded'
  | 'no-response'
  | 'unknown-question'
  | 'repeated-answer'
  | 'missing-answer'
  | 'invalid-answer'
  | 'widget-mismatch'
  | 'file-upload-needs-sign-in'
  | 'invalid-layout'
  | 'invalid-name'
  | 'invalid-sharing'
  | 'tally-hidden'
  | 'conflict'
  | 'internal';

/** A refused or failed write, in words the UI can show. */
export type FormWriteFailure = {
  message: string;
  /** The forms service's refusal, when it explained itself. */
  refusal?: FormRefusal;
  /** The question a refused answer or layout names. */
  questionId?: string;
};

/** One form's detail as the server last answered it. */
export type FormDetailSource = {
  /** Undefined until loaded. */
  detail: Accessor<FormDetail | undefined>;
  failure: Accessor<FormLoadFailure | undefined>;
  /** Read again; resolves whether the read succeeded (a failed read resolves too). */
  refetch: () => Promise<boolean>;
};

export type FormMetadataPatch = {
  description?: string;
  confirmationMessage?: string;
  audience?: FormAudience;
  status?: FormStatus;
  closesAt?: string | null;
  tallyVisible?: boolean;
};

export type ReadSource<Value> = {
  value: Accessor<Value | undefined>;
  failure: Accessor<FormLoadFailure | undefined>;
};

/**
 * What Macro Forms needs from the app. Production wiring lives in
 * `../form-context-production.tsx`; tests supply their own.
 */
export type FormContext = {
  createFormSource: (formId: Accessor<string>) => FormDetailSource;
  updateMetadata: (
    formId: string,
    patch: FormMetadataPatch
  ) => ResultAsync<void, FormWriteFailure>;
  /** Move the form to the trash; its database and response rows stay. */
  trashForm: (formId: string) => ResultAsync<void, FormWriteFailure>;
  /** Ask before something destructive; resolves with the choice. */
  confirm: (question: {
    title: string;
    body: string;
    confirmLabel: string;
    tone: 'default' | 'danger';
  }) => Promise<boolean>;
  responses: {
    createSummary: (
      formId: Accessor<string>,
      enabled: Accessor<boolean>
    ) => ReadSource<ResponseCounts>;
  };
  notify: {
    success: (message: string) => void;
    failure: (message: string) => void;
  };
};

const Context = createContext<FormContext>();

export const FormProvider = Context.Provider;

export function useFormContext(): FormContext {
  const context = useContext(Context);
  if (!context) throw new Error('FormProvider is required');
  return context;
}
