import type { PreviewPanelSelection } from '@components/app/previewTarget';

export type EntityDetailTarget = PreviewPanelSelection & {
  fallbackName?: string;
};

type DocumentSelection = Extract<PreviewPanelSelection, { type: 'document' }>;

export type EntityDetailDocumentTargetInput = Omit<
  DocumentSelection,
  'type'
> & {
  fallbackName?: string;
};

export type EntityDetailChannelMessageTargetInput = {
  channelId: string;
  messageId: string;
  threadId?: string;
  fallbackName?: string;
};

export function createEntityDetailTarget<
  TSelection extends PreviewPanelSelection,
>(
  selection: TSelection,
  fallbackName?: string
): TSelection & { fallbackName?: string } {
  return {
    ...selection,
    ...(fallbackName !== undefined ? { fallbackName } : {}),
  };
}

export const entityDetailTarget = {
  fromSelection: createEntityDetailTarget,
  document(input: EntityDetailDocumentTargetInput): EntityDetailTarget {
    const { fallbackName, ...selection } = input;
    return createEntityDetailTarget(
      { ...selection, type: 'document' },
      fallbackName
    );
  },
  channelMessage(
    input: EntityDetailChannelMessageTargetInput
  ): EntityDetailTarget {
    return createEntityDetailTarget(
      {
        id: input.messageId,
        type: 'channel_message',
        channelId: input.channelId,
        messageId: input.messageId,
        threadId: input.threadId,
        target: {
          messageId: input.messageId,
          threadId: input.threadId,
        },
      },
      input.fallbackName
    );
  },
};

export type EntityDetailNavigationOptions = {
  event?: KeyboardEvent | MouseEvent;
};

export type EntityDetailNavigationEntry = {
  value: string;
  data: EntityDetailTarget;
};
