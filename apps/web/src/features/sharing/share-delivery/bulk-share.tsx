import { EntityActionSelection } from '@app/features/entity/bulk-edit/components/EntityActionSelection';
import { isShareableEntity } from '@app/features/sharing/global-share-modal/shareable-entity';
import { createConfiguredChannelMarkdownEditor } from '@channel/Input';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { ShareRecipientField } from '@core/component/ShareRecipientField';
import { refetchDocumentShareButtonResource } from '@core/component/TopBar/ShareButton';
import { itemToBlockName } from '@core/constant/allBlocks';
import { useUserId } from '@core/context/user';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { EntityData } from '@entity';
import { createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type RecipientOption,
  toShareItem,
  useShareForm,
} from './share-delivery';
import { type BulkShareHandle, BulkShareView } from './views/bulk-share-view';

export type { BulkShareHandle } from './views/bulk-share-view';

export function BulkShare(props: {
  entities: EntityData[];
  onFinish: () => void;
  onCancel: () => void;
  ref?: (handle: BulkShareHandle) => void;
}) {
  const viewerId = useUserId();
  const items = createMemo(() =>
    props.entities.filter(isShareableEntity).map((entity) =>
      toShareItem({
        id: entity.id,
        kind: entity.type,
        name: entity.name,
        block: itemToBlockName(entity),
        canGrant: entity.ownerId === viewerId(),
      })
    )
  );
  const form = useShareForm(items, { location: 'bulk_share' });
  const editor = createConfiguredChannelMarkdownEditor({
    namespace: 'bulk-share-markdown',
    resolveAppLink: useMacroMentionLinkResolver(),
    enableMentions: true,
    onChange: form.setText,
  });
  const { all: options } = useCombinedRecipients();

  return (
    <BulkShareView
      form={form}
      count={items().length}
      selection={<EntityActionSelection entities={props.entities} />}
      recipientField={<ShareRecipientField form={form} options={options} />}
      messageField={
        <MarkdownShell
          config={editor}
          placeholder="Optional message"
          portalScope="local"
          class="text-sm"
          disabled={form.locked()}
        />
      }
      focusMessage={() => editor.controls.focus()}
      recipientName={recipientName}
      onSubmitted={refetchDocumentShareButtonResource}
      onFinish={props.onFinish}
      onCancel={props.onCancel}
      ref={props.ref}
    />
  );
}

function recipientName(recipient: RecipientOption): string {
  return match(recipient)
    .with({ kind: 'channel' }, ({ id, data }) => data.name ?? id)
    .with(
      { kind: 'user' },
      { kind: 'contact' },
      ({ data }) => data.name || data.email
    )
    .with({ kind: 'custom' }, ({ data }) => data.email)
    .exhaustive();
}
