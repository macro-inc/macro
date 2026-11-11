import { useMaybeBlockName } from '@core/block';
import { splitProps } from 'solid-js';
import { createLexicalMentionMenuHost } from '../../../editing/overlay-hosts/lexical-mentions';
import { HostedMentionsMenu } from './HostedMentionsMenu';
import type { MentionsMenuProps } from './props';

export { HostedMentionsMenu } from './HostedMentionsMenu';

export function MentionsMenu(props: MentionsMenuProps) {
  const [model, options] = splitProps(props, ['editor', 'onPick']);
  if (props.onPick) {
    return (
      <HostedMentionsMenu
        {...options}
        anchor={props.anchor}
        onPick={props.onPick}
      />
    );
  }
  return (
    <HostedMentionsMenu
      {...options}
      createHost={(blockId) =>
        createLexicalMentionMenuHost(
          () => model.editor,
          model.editor
            ? {
                editor: model.editor,
                blockName: useMaybeBlockName(),
                blockId,
                onUserMention: props.onUserMention,
                onDocumentMention: props.onDocumentMention,
                onEmailMention: props.onEmailMention,
                disableMentionTracking: props.disableMentionTracking,
              }
            : undefined
        )
      }
    />
  );
}
