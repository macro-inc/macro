import { useSplitLayout } from '@components/app/split-layout/layout';
import type { MagicChipDecoratorProps } from '@macro-inc/lexical-core';
import type { Component } from 'solid-js';
import { createMagicChipModel } from './create-magic-chip-model';
import { MagicChipView } from './MagicChipView';

/** Lexical decorator for a `<m-magic-chip>` node in a channel message. */
export const MagicChip: Component<MagicChipDecoratorProps> = (props) => {
  const { insertSplit } = useSplitLayout();
  const model = createMagicChipModel(props);

  return (
    <MagicChipView
      agentSessionId={props.agentSessionId}
      presentation={model.presentation()}
      answer={{
        answering: model.elicitation.answering(),
        respond: model.elicitation.respond,
      }}
      onOpen={() => insertSplit({ type: 'agent', id: props.agentSessionId })}
    />
  );
};
