import { useSplitLayout } from '@components/app/split-layout/layout';
import type { MagicChipData } from '@macro-inc/lexical-core';
import { $createNodeSelection, $setSelection, type NodeKey } from 'lexical';
import { type Component, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../../context/LexicalWrapperContext';
import { createMagicChipModel } from './create-magic-chip-model';
import { MagicChipView } from './MagicChipView';

/** Shared session response surface, optionally anchored to one turn. */
export const MagicChip: Component<
  MagicChipData & { key?: NodeKey; onCollapse?: () => void }
> = (props) => {
  const { insertSplit } = useSplitLayout();
  const model = createMagicChipModel(props);
  const wrapper = useContext(LexicalWrapperContext);
  const inDocument = () =>
    wrapper?.type === 'markdown' || wrapper?.type === 'markdown-sync';
  const selected = () =>
    Boolean(
      props.key &&
        wrapper?.selection?.type === 'node' &&
        wrapper.selection.nodeKeys.has(props.key)
    );
  const selectNode = () => {
    const key = props.key;
    if (!key || !wrapper?.editor.isEditable()) return;
    wrapper.editor.update(() => {
      const selection = $createNodeSelection();
      selection.add(key);
      $setSelection(selection);
    });
  };

  return (
    <MagicChipView
      agentSessionId={props.agentSessionId}
      presentation={model.presentation()}
      header={model.header()}
      loading={model.loading()}
      inDocument={inDocument()}
      selected={selected()}
      onSelect={
        inDocument() && wrapper?.editor.isEditable() ? selectNode : undefined
      }
      onCollapse={props.onCollapse}
      onOpen={() => insertSplit({ type: 'agent', id: props.agentSessionId })}
    />
  );
};
