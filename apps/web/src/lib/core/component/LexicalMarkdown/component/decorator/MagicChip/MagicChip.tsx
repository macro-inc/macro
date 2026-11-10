import { useSplitLayout } from '@components/app/split-layout/layout';
import { $createNodeSelection, $setSelection, type NodeKey } from 'lexical';
import { type Component, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../../context/LexicalWrapperContext';
import type { MagicChipHostProp } from '../../../decorator-host/magic-host';
import { createMagicChipModel } from './create-magic-chip-model';
import { MagicChipView } from './MagicChipView';
import type { MagicChipUIData } from './types';

/** Shared session response surface, optionally anchored to one turn. */
export const MagicChip: Component<
  MagicChipUIData &
    MagicChipHostProp & { key?: NodeKey; onCollapse?: () => void }
> = (props) => {
  const { insertSplit } = useSplitLayout();
  const model = createMagicChipModel(props);
  const wrapper = useContext(LexicalWrapperContext);
  const inDocument = () =>
    props.host
      ? props.host.isDocument()
      : wrapper?.type === 'markdown' || wrapper?.type === 'markdown-sync';
  const editable = () =>
    props.host ? props.host.isEditable() : wrapper?.editor.isEditable();
  const selected = () =>
    Boolean(
      props.key &&
        (props.host
          ? props.host.isSelected(props.key)
          : wrapper?.selection?.type === 'node' &&
            wrapper.selection.nodeKeys.has(props.key))
    );
  const selectNode = () => {
    const key = props.key;
    if (props.host) {
      if (key && props.host.isEditable()) props.host.selectNode(key);
      return;
    }
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
      onSelect={inDocument() && editable() ? selectNode : undefined}
      onCollapse={props.onCollapse}
      onOpen={() => insertSplit({ type: 'agent', id: props.agentSessionId })}
    />
  );
};
