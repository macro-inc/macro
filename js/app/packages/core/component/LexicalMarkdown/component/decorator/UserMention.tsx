import type { UserMentionDecoratorProps } from '@lexical-core';
import { useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

export function UserMention(props: UserMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  return (
    <span
      class={`relative py-0.5 px-0.5 cursor-default rounded-xs bg-accent/8 hover:bg-accent/20 focus:bg-accent/20 text-accent-ink`}
      classList={{
        'bracket-offset-2': isSelectedAsNode(),
      }}
    >
      <span
        data-user-id={props.userId}
        data-email={props.email}
        data-user-mention="true"
      >
        @{props.email.split('@')[0]}
      </span>
    </span>
  );
}
