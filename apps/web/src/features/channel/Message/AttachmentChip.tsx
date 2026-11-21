import { PullRequestAttachment } from '@app/features/block-pr/component/PullRequestAttachment';
import { ProjectAttachment } from '@app/features/projects/project-attachment';
import { ItemPreview } from '@core/component/ItemPreview';
import { stringToItemType } from '@service-storage/client';
import { Match, Switch } from 'solid-js';

/** How a message shows one of its non-media attachments. */
export function AttachmentChip(props: {
  attachment: { entity_id: string; entity_type: string };
  /** Class for the item preview chip, the fallback for most entity types. */
  previewClass?: string;
}) {
  return (
    <Switch
      fallback={
        <ItemPreview
          id={props.attachment.entity_id}
          type={stringToItemType(props.attachment.entity_type)}
          class={props.previewClass}
        />
      }
    >
      <Match when={props.attachment.entity_type === 'initiative'}>
        <ProjectAttachment id={props.attachment.entity_id} />
      </Match>
      <Match
        when={stringToItemType(props.attachment.entity_type) === 'foreign'}
      >
        <PullRequestAttachment id={props.attachment.entity_id} />
      </Match>
    </Switch>
  );
}
