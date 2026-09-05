import { DOCS_BASE } from '@app/constants/docs-links';
import {
  runCreateAction,
  useCreatableEnabled,
} from '@app/features/command/Launcher';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import EmptyStateChannelsGraphic from '@design/empty-state-channels.svg';
import BookOpenIcon from '@phosphor/book-open.svg';
import PlusIcon from '@phosphor/plus.svg';
import { EmptyStatePanel, type EmptyStateAction } from '@ui';
import type { ChannelsQueryScope } from '../types';

type ChannelsEmptyStateContent = {
  title: string;
  description: string;
  action: EmptyStateAction;
};

function emptyStateContent(
  scope: ChannelsQueryScope
): ChannelsEmptyStateContent {
  if (scope === 'channels') {
    return {
      title: 'No channels to show',
      description: 'Channels you join or create will appear here.',
      action: {
        label: 'New channel',
        icon: PlusIcon,
        onClick: openNewChannelModal,
      },
    };
  }

  if (scope === 'direct_messages') {
    return {
      title: 'No direct messages',
      description: 'Start a private conversation with someone.',
      action: {
        label: 'Start direct message',
        icon: PlusIcon,
        onClick: () => runCreateAction('channel'),
      },
    };
  }

  return {
    title: 'No recent conversations',
    description: 'Your latest conversations will appear here.',
    action: {
      label: 'Start a conversation',
      icon: PlusIcon,
      onClick: () => runCreateAction('channel'),
    },
  };
}

export function ChannelsEmptyState(props: {
  scope: ChannelsQueryScope;
  topAligned?: boolean;
}) {
  const isCreatableEnabled = useCreatableEnabled();
  const content = () => emptyStateContent(props.scope);

  return (
    <EmptyStatePanel
      centered
      graphic={EmptyStateChannelsGraphic}
      graphicClass="aspect-square h-auto w-[clamp(12rem,70%,18rem)] self-center"
      title={content().title}
      description={content().description}
      descriptionClass="mt-1 text-balance"
      actionsClass="mt-5 flex-row @max-sm:flex-row"
      primaryAction={
        isCreatableEnabled('channel') ? content().action : undefined
      }
      documentationUrl={`${DOCS_BASE}/product/channels`}
      documentationIcon={BookOpenIcon}
      class={
        props.topAligned
          ? 'px-4 pt-4 @4xl:px-4 [&>div:first-child]:basis-0'
          : 'px-4 @4xl:px-4'
      }
    />
  );
}
