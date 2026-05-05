import { cn } from '@ui/utils/classname';
import type { GroupMentionDecoratorProps } from '@lexical-core';
import { useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

export function GroupMention(props: GroupMentionDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  return (
    <span
      class={cn(
        'relative py-0.5 px-0.5 cursor-default rounded-xs bg-accent/8 hover:bg-accent/20 focus:bg-accent/20 text-accent-ink',
        isSelectedAsNode() && 'bg-active'
      )}
    >
      <span data-group-alias={props.groupAlias} data-group-mention="true">
        @{props.groupAlias}
      </span>
    </span>
  );
}
