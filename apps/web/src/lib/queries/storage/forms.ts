/** Forms: their detail, layout, metadata, responses and tallies (RFC 02 §1). */
import { analytics } from '@app/lib/analytics';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableForms } from '@core/constant/featureFlags';
import {
  catchToResult,
  type ResultError,
  ThrownResultError,
  throwOnErr,
} from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { FormsError } from '@service-storage/forms';
import type { CreateForm } from '@service-storage/generated/schemas/createForm';
import type { Form } from '@service-storage/generated/schemas/form';
import type { FormCollaboration } from '@service-storage/generated/schemas/formCollaboration';
import type { FormDetail } from '@service-storage/generated/schemas/formDetail';
import type { FormLayout } from '@service-storage/generated/schemas/formLayout';
import type { Submission } from '@service-storage/generated/schemas/submission';
import type { SubmissionOutcome } from '@service-storage/generated/schemas/submissionOutcome';
import type { UpdateForm } from '@service-storage/generated/schemas/updateForm';
import { useQueries, useQuery } from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { channelParticipantsQueryOptions } from '../channel/channel-participants';
import { queryClient } from '../client';
import { formsKeys, myResponseKeyOf } from './keys';

const FORM_STALE_TIME = 30 * 1000;

/** Every form the viewer can open, for Drive and Quick Access. */
export function useFormsQuery() {
  const flag = useFeatureFlag(enableForms);
  return useQuery(() => ({
    queryKey: formsKeys.list.queryKey,
    queryFn: () =>
      throwOnErr(async () => storageServiceClient.forms.listAccessible()),
    staleTime: FORM_STALE_TIME,
    enabled: flag().enabled,
  }));
}

/**
 * The live forms over a database, for its "Forms" chip and delete warnings.
 * Not flag-gated: a destructive warning must name forms a flagged owner made;
 * the authoring controls that use it are gated where they mount.
 */
export function useFormsForDatabaseQuery(
  databaseId: Accessor<string | undefined>
) {
  return useQuery(() => {
    const id = databaseId();
    return {
      queryKey: formsKeys.forDatabase(id ?? '').queryKey,
      queryFn: (): Promise<Form[]> =>
        throwOnErr(async () =>
          storageServiceClient.forms.listForDatabase({ databaseId: id ?? '' })
        ),
      staleTime: FORM_STALE_TIME,
      enabled: !!id,
    };
  });
}

export function formDetailQueryOptions(formId: string) {
  return {
    queryKey: formsKeys.detail(formId).queryKey,
    queryFn: (): Promise<FormDetail> =>
      throwOnErr(async () => storageServiceClient.forms.get({ id: formId })),
    staleTime: FORM_STALE_TIME,
  };
}

export function useFormDetailQuery(formId: Accessor<string | undefined>) {
  return useQuery(() => {
    const id = formId();
    return {
      ...formDetailQueryOptions(id ?? ''),
      enabled: !!id,
      // A form you cannot open stays unopened; retrying a 404 changes nothing.
      retry: false,
    };
  });
}

/**
 * Read a form through its detail cache, for the block loader: the page then
 * reads the same entry instead of asking again.
 */
export function fetchFormDetail(
  formId: string
): ResultAsync<FormDetail, ResultError[]> {
  return new ResultAsync(
    catchToResult(() => queryClient.fetchQuery(formDetailQueryOptions(formId)))
  );
}

/**
 * Call back once when a form's cached detail first holds a question, i.e.
 * the builder saved it; answers a stop. The `/form` card waits for this.
 */
export function onFormFirstQuestion(
  formId: string,
  built: (name: string) => void
): () => void {
  const key = formsKeys.detail(formId).queryKey;
  let done = false;
  const stop = queryClient.getQueryCache().subscribe(() => {
    if (done) return;
    const detail = queryClient.getQueryData<FormDetail>(key);
    const asked = detail?.sections.some(
      (section) => section.kind === 'questions' && section.questions.length > 0
    );
    if (!detail || !asked) return;
    done = true;
    stop();
    built(detail.form.name);
  });
  return () => {
    done = true;
    stop();
  };
}

/** Seed the detail cache with what a write answered. */
export function setFormDetail(detail: FormDetail) {
  queryClient.setQueryData(formsKeys.detail(detail.form.id).queryKey, detail);
}

/** Open or publish the shared layout and cache its validated projection. */
export function collaborateOnForm(
  formId: string
): ResultAsync<FormCollaboration, FormsError[]> {
  return storageServiceClient.forms
    .collaborate({ id: formId })
    .map((result) => {
      setFormDetail(result.detail);
      return result;
    });
}

/** After a form's metadata or existence changed, its lists read again. */
function invalidateFormLists(databaseId?: string) {
  void queryClient.invalidateQueries({ queryKey: formsKeys.list.queryKey });
  if (databaseId)
    void queryClient.invalidateQueries({
      queryKey: formsKeys.forDatabase(databaseId).queryKey,
    });
}

export function createForm(
  request: CreateForm,
  source: string
): ResultAsync<FormDetail, FormsError[]> {
  return storageServiceClient.forms.create(request).map((detail) => {
    analytics.track('create_entity', {
      entityType: 'form',
      entityId: detail.form.id,
      source,
    });
    setFormDetail(detail);
    invalidateFormLists(detail.form.databaseId);
    return detail;
  });
}

/** Save the shared draft and report whether it became the respondent version. */
export function putFormLayout(
  formId: string,
  layout: FormLayout
): ResultAsync<FormCollaboration, FormsError[]> {
  return storageServiceClient.forms
    .putLayout({ id: formId, layout })
    .map((result) => {
      setFormDetail(result.detail);
      return result;
    });
}

export function updateForm(
  formId: string,
  request: UpdateForm
): ResultAsync<Form, FormsError[]> {
  return storageServiceClient.forms
    .update({ id: formId, request })
    .map((form) => {
      queryClient.setQueryData(
        formsKeys.detail(formId).queryKey,
        (previous: FormDetail | undefined) =>
          previous ? { ...previous, form } : previous
      );
      invalidateFormLists(form.databaseId);
      return form;
    });
}

/** Re-read the viewer's own response and the counts a new response moves. */
function afterResponse(formId: string) {
  void queryClient.invalidateQueries({ queryKey: myResponseKeyOf(formId) });
  void queryClient.invalidateQueries({
    queryKey: formsKeys.summary(formId).queryKey,
  });
  void queryClient.invalidateQueries({
    queryKey: formsKeys.tally(formId).queryKey,
  });
}

export function submitResponse(
  formId: string,
  submission: Submission
): ResultAsync<SubmissionOutcome, FormsError[]> {
  return storageServiceClient.forms
    .submit({ id: formId, submission })
    .map((outcome) => {
      afterResponse(formId);
      return outcome;
    });
}

export function editMyResponse(
  formId: string,
  submission: Submission
): ResultAsync<SubmissionOutcome, FormsError[]> {
  return storageServiceClient.forms
    .editMyResponse({ id: formId, submission })
    .map((outcome) => {
      afterResponse(formId);
      return outcome;
    });
}

/** The signed-in viewer's own response; `null` until they respond. */
export function useMyResponseQuery(
  formId: Accessor<string | undefined>,
  userId: Accessor<string | undefined>
) {
  return useQuery(() => {
    const id = formId();
    const user = userId();
    return {
      queryKey: formsKeys.mine(id ?? '', user ?? '').queryKey,
      queryFn: async () => {
        const result = await storageServiceClient.forms.getMyResponse({
          id: id ?? '',
        });
        if (result.isOk()) return result.value;
        if (result.error.some((error) => error.refusal?.code === 'noResponse'))
          return null;
        throw new ThrownResultError(result.error);
      },
      enabled: !!id && !!user,
      retry: false,
    };
  });
}

/** A form's response counts; editors only, so callers say when to read. */
export function useResponseSummaryQuery(
  formId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => {
    const id = formId();
    return {
      queryKey: formsKeys.summary(id).queryKey,
      queryFn: () =>
        throwOnErr(async () => storageServiceClient.forms.getSummary({ id })),
      enabled: enabled(),
    };
  });
}

export function useTallyQuery(
  formId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => {
    const id = formId();
    return {
      queryKey: formsKeys.tally(id ?? '').queryKey,
      queryFn: () =>
        throwOnErr(async () =>
          storageServiceClient.forms.getTally({ id: id ?? '' })
        ),
      enabled: !!id && enabled(),
      retry: false,
    };
  });
}

/** A form's share grants (channels, team). Only its owner can read them. */
export function useFormSharePermissionsQuery(
  formId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => {
    const id = formId();
    return {
      queryKey: formsKeys.permissions(id ?? '').queryKey,
      queryFn: () =>
        throwOnErr(async () =>
          storageServiceClient.forms.getPermissions({ id: id ?? '' })
        ),
      enabled: !!id && enabled(),
      retry: false,
    };
  });
}

/**
 * How many distinct people the channels a form was posted in hold, for "n% of
 * invited": `null` when it was posted nowhere, undefined while reading.
 * Sharing is owner-only, so other editors read nothing.
 */
export function useFormInvitedCount(
  formId: Accessor<string | undefined>,
  /** Not counted: the owner is in every channel they posted to. */
  ownerId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  const permissions = useFormSharePermissionsQuery(formId, enabled);
  const channelIds = () =>
    permissions.isSuccess
      ? (permissions.data.channelSharePermissions ?? []).map(
          (grant) => grant.channel_id
        )
      : [];
  const participants = useQueries(() => ({
    queries: channelIds().map(channelParticipantsQueryOptions),
  }));
  return {
    count: (): number | null | undefined => {
      if (!permissions.isSuccess) return undefined;
      if (channelIds().length === 0) return null;
      if (!participants.every((query) => query.isSuccess)) return undefined;
      const people = new Set(
        participants.flatMap((query) =>
          (query.data ?? []).map((participant) => participant.user_id)
        )
      );
      const owner = ownerId();
      if (owner) people.delete(owner);
      return people.size;
    },
    error: () =>
      permissions.error ?? participants.find((query) => query.isError)?.error,
  };
}

/** Native sharing adapters retain Result so the shared dialog can render failures. */
export function getFormSharePermissions(id: string) {
  return storageServiceClient.forms.getPermissions({ id });
}

export function updateFormSharePermissions(
  params: Parameters<typeof storageServiceClient.forms.updatePermissions>[0]
) {
  return storageServiceClient.forms
    .updatePermissions(params)
    .map((permissions) => {
      queryClient.setQueryData(
        formsKeys.permissions(params.id).queryKey,
        permissions
      );
      return permissions;
    });
}
