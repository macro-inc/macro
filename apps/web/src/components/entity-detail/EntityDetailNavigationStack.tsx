import {
  NavigationStack,
  type NavigationStackEntry,
  type NavigationStackOutletProps,
  type NavigationStackRootProps,
  useMaybeNavigationStack,
  useNavigationStack,
} from '@app/components/navigation-stack/NavigationStack';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import type { PreviewPanelSelection } from '@components/app/PreviewPanel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

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

/**
 * Inline detail is a desktop affordance. Touch layouts open every entity in
 * the split, and a modifier click asks for a split explicitly. A view passes
 * `shouldNavigate` to replace this policy.
 */
function opensInline(options?: EntityDetailNavigationOptions) {
  const event = options?.event;
  return (
    !isTouchDevice() &&
    !(event?.shiftKey || event?.metaKey || event?.ctrlKey || event?.altKey)
  );
}

function Root(props: EntityDetailNavigationStackRootProps) {
  const selectPreview = createPreviewSelectionGuard();
  return (
    <NavigationStack.Root<EntityDetailTarget, EntityDetailNavigationOptions>
      {...props}
      beforeChange={(target) =>
        props.beforeChange?.(target) !== false && selectPreview(target)
      }
      shouldNavigate={(target, options) =>
        props.shouldNavigate
          ? props.shouldNavigate(target, options)
          : opensInline(options)
      }
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
