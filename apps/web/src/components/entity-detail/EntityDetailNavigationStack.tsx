import {
  NavigationStack,
  type NavigationStackEntry,
  type NavigationStackOutletProps,
  type NavigationStackRootProps,
  useMaybeNavigationStack,
  useNavigationStack,
} from '@app/components/navigation-stack/NavigationStack';
import type { PreviewPanelSelection } from '@components/app/PreviewPanel';

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

export type EntityDetailNavigationStackEntry =
  NavigationStackEntry<EntityDetailTarget>;

export type EntityDetailNavigationStackRootProps = NavigationStackRootProps<
  EntityDetailTarget,
  EntityDetailNavigationOptions
>;

export type EntityDetailNavigationStackOutletProps = NavigationStackOutletProps<
  EntityDetailTarget,
  EntityDetailNavigationOptions
>;

function Root(props: EntityDetailNavigationStackRootProps) {
  return (
    <NavigationStack.Root<EntityDetailTarget, EntityDetailNavigationOptions>
      {...props}
    />
  );
}

function Outlet(props: EntityDetailNavigationStackOutletProps) {
  return (
    <NavigationStack.Outlet<EntityDetailTarget, EntityDetailNavigationOptions>
      {...props}
    />
  );
}

export function useEntityDetailNavigationStack() {
  return useNavigationStack<
    EntityDetailTarget,
    EntityDetailNavigationOptions
  >();
}

export function useMaybeEntityDetailNavigationStack() {
  return useMaybeNavigationStack<
    EntityDetailTarget,
    EntityDetailNavigationOptions
  >();
}

export const EntityDetailNavigationStack = Object.assign(Root, {
  Root,
  Outlet,
});
