import { EntityAppearanceTrigger } from '@app/features/entity-appearance/entity-appearance';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { getPermissions } from '@core/component/SharePermissions';
import type { Accessor } from 'solid-js';
import type { FormDetail } from '../../core/form-model';
import type { createPreview } from '../../primitives/create-preview';

/** What the form block's header shows and does, read once by its entry. */
export interface FormBlockHeaderProps {
  formId: string;
  detail: Accessor<FormDetail | undefined>;
  name: Accessor<string>;
  /** The respond view alone: no live viewers and no form actions. */
  respondOnly: boolean;
  /** Owners who haven't shared the form publish it; everyone else opens it. */
  published: Accessor<boolean>;
  preview: ReturnType<typeof createPreview>;
  openShare: () => void;
  openRespond: () => void;
  copyRespondLink: () => void;
}

/** Whether the viewer edits the form, so it shows viewers and actions. */
export function canEditForm(detail: FormDetail | undefined) {
  return detail?.access === 'edit' || detail?.access === 'owner';
}

/** The form's appearance, which editors can change, as the title icon. */
export function FormTitleIcon(props: { detail: FormDetail }) {
  return (
    <EntityAppearanceTrigger
      entity={{
        type: 'form',
        id: props.detail.form.id,
        name: props.detail.form.name,
        ownerId: props.detail.form.ownerId,
        access: props.detail.access,
        appearance: props.detail.form.appearance,
      }}
      editable={canEditForm(props.detail)}
    />
  );
}

/** The form's title menu: its entity actions and Move to folder. */
export function FormFileMenu(props: {
  formId: string;
  detail: FormDetail;
  buttonClass?: string;
}) {
  return (
    <SplitFileMenu
      id={props.formId}
      itemType="form"
      entityKind="form"
      name={props.detail.form.name}
      entity={{
        type: 'form',
        id: props.formId,
        name: props.detail.form.name,
        ownerId: props.detail.form.ownerId,
        access: props.detail.access,
      }}
      permissions={getPermissions(props.detail.access)}
      ops={[{ op: 'moveToProject' }]}
      buttonClass={props.buttonClass}
    />
  );
}
