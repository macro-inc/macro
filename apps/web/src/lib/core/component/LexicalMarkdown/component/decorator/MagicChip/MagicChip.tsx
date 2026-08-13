import { useSplitLayout } from '@components/app/split-layout/layout';
import type { MagicChipDecoratorProps } from '@macro-inc/lexical-core';
import type { Component } from 'solid-js';
import { createMagicChipModel } from './create-magic-chip-model';
import { MagicChipView } from './MagicChipView';

/** Connect the Magic Chip's live model to its pure visual surface. */
export const MagicChip: Component<MagicChipDecoratorProps> = (props) => {
  const { insertSplit } = useSplitLayout();
  const model = createMagicChipModel(props);

  return (
    <MagicChipView
      agentSessionId={props.agentSessionId}
      presentation={model.presentation()}
      onOpen={
        props.channelId
          ? () => insertSplit({ type: 'channel', id: props.channelId! })
          : undefined
      }
    />
  );
};
