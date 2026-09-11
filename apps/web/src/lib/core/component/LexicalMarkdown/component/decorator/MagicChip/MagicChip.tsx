import { useSplitLayout } from '@components/app/split-layout/layout';
import type { MagicChipData } from '@macro-inc/lexical-core';
import type { Component } from 'solid-js';
import { createMagicChipModel } from './create-magic-chip-model';
import { MagicChipView } from './MagicChipView';

/** Shared session response surface, optionally anchored to one turn. */
export const MagicChip: Component<
  MagicChipData & { onCollapse?: () => void }
> = (props) => {
  const { insertSplit } = useSplitLayout();
  const model = createMagicChipModel(props);

  return (
    <MagicChipView
      agentSessionId={props.agentSessionId}
      presentation={model.presentation()}
      header={model.header()}
      onCollapse={props.onCollapse}
      answer={{
        answering: model.elicitation.answering(),
        respond: model.elicitation.respond,
      }}
      onOpen={() => insertSplit({ type: 'agent', id: props.agentSessionId })}
    />
  );
};
