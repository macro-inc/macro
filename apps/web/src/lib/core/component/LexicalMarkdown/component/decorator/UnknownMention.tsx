import Fallback from '@icon/system/regular/placeholder.svg';
import type { UnknownMentionDecoratorProps } from '@macro-inc/lexical-core';
import { useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import type { DecoratorSelectionHostProp } from '../../decorator-host/selection-host';

/** Source `importJSON` keeps a stored null or omitted name; it renders as "Unknown". */
export type UnknownMentionUIProps = Omit<
  UnknownMentionDecoratorProps,
  'name'
> & {
  name?: string | null;
} & DecoratorSelectionHostProp;

export function UnknownMention(props: UnknownMentionUIProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;

  const isSelectedAsNode = () => {
    const host = props.host;
    if (host) return host.isSelected(props.key);
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  return (
    <span
      class="relative rounded-md p-0.5 cursor-default text-ink-muted/50"
      classList={{
        'bg-active': isSelectedAsNode(),
      }}
    >
      <span class="relative top-[0.125em] size-[1em] inline-flex mx-1 opacity-50">
        <Fallback />
      </span>
      <span>{props.name || 'Unknown'}</span>
    </span>
  );
}
