/**
 * Sharing a form from outside its block (Drive, Quick Access): the native
 * share dialog with the form's respond link and audience controls, at the
 * form's own access. The detail loads before the dialog opens and stays live
 * inside it, so an audience change shows as soon as it is saved.
 */
import { getPermissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import { ShareModal } from '@core/component/TopBar/ShareButton';
import type { ShareModalInput } from '@core/component/TopBar/shareModal';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import { getWebOrigin } from '@core/util/webOrigin';
import { fetchFormDetail, useFormDetailQuery } from '@queries/storage/forms';
import { type DialogHandle, type ManagedDialogProps, openDialog } from '@ui';
import { type Accessor, Show, Suspense } from 'solid-js';
import type { FormContext } from './context/form-context';
import type { FormDetail } from './core/form-model';
import { respondLink } from './core/respond-link';
import { FormLinkSharing } from './form-link-sharing';
import { createAudienceChange } from './primitives/create-audience-change';
import { toFormDetail } from './queries/form-detail';
import { updateFormMetadata } from './queries/form-sources';

/**
 * The share dialog's input for a form: its respond link is what Copy link
 * hands out, and its link area is the form's audience and editor link.
 * Undefined until the detail has loaded.
 */
export function createFormShareInput(options: {
  formId: Accessor<string>;
  detail: Accessor<FormDetail | undefined>;
  updateMetadata: FormContext['updateMetadata'];
  notify: FormContext['notify'];
}): Accessor<ShareModalInput | undefined> {
  // Shared links open on the web, even from the desktop app.
  const link = () => respondLink(`${getWebOrigin()}/app/`, options.formId());
  const copyLink = useCopyLink();
  const audience = createAudienceChange(options);
  // One component for the dialog's life: a refreshed detail must not remount it.
  const linkSharing = () => (
    <Show when={options.detail()}>
      {(detail) => (
        <FormLinkSharing
          detail={detail()}
          respondLink={link()}
          editorLink={buildSimpleEntityUrl({
            type: 'form',
            id: options.formId(),
          })}
          pending={audience.pending()}
          onAudienceChange={(next) => void audience.change(next)}
          onCopyFailure={() => options.notify.failure('Could not copy link.')}
        />
      )}
    </Show>
  );
  return () => {
    const detail = options.detail();
    if (!detail) return;
    return {
      id: options.formId(),
      blockAlias: 'form',
      itemType: 'form',
      name: detail.form.name,
      owner: detail.form.ownerId,
      // The form's own access, as the service answered it.
      userPermissions: getPermissions(detail.access),
      copyLink: () => void copyLink(link()),
      linkSharing,
    };
  };
}

const notify: FormContext['notify'] = {
  success: (message) => toast.success(message),
  failure: (message) => toast.failure(message),
};

function FormShareDialog(props: ManagedDialogProps & { formId: string }) {
  const query = useFormDetailQuery(() => props.formId);
  const input = createFormShareInput({
    formId: () => props.formId,
    detail: () => (query.isSuccess ? toFormDetail(query.data) : undefined),
    updateMetadata: updateFormMetadata,
    notify,
  });
  return (
    <Show when={input()}>
      {(current) => (
        <Suspense>
          <ShareModal
            {...current()}
            open={props.open}
            onOpenChange={props.onOpenChange}
          />
        </Suspense>
      )}
    </Show>
  );
}

/**
 * Opens a form's share dialog once its detail has loaded; a form that can't
 * be read is told and nothing opens.
 */
export async function openFormShareModal(
  formId: string
): Promise<DialogHandle | undefined> {
  const detail = await fetchFormDetail(formId);
  if (detail.isErr()) {
    notify.failure('This form’s sharing couldn’t be loaded.');
    return;
  }
  return openDialog(FormShareDialog, { formId });
}
