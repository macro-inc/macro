import { useSplitLayout } from '@components/app/split-layout/layout';
import type { MagicChipDecoratorProps } from '@macro-inc/lexical-core';
import { type Component, createSignal } from 'solid-js';
import { createMagicChipModel } from './create-magic-chip-model';
import { deriveMagicChipDisplay } from './display';
import { MagicChipView } from './MagicChipView';

/** Connect the Magic Chip's live model to its visual surface. */
export const MagicChip: Component<MagicChipDecoratorProps> = (props) => {
  const { insertSplit } = useSplitLayout();
  const model = createMagicChipModel(props);
  const [openedByReader, setOpenedByReader] = createSignal(false);

  const display = () =>
    deriveMagicChipDisplay({
      presentation: model.presentation(),
      openedByReader: openedByReader(),
      agent: model.agent(),
    });

  return (
    <MagicChipView
      agentSessionId={props.agentSessionId}
      display={display()}
      actions={{
        openSession: () =>
          insertSplit({ type: 'agent', id: props.agentSessionId }),
        setOpened: setOpenedByReader,
      }}
    />
  );
};
