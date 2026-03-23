import { useMaybeSoup } from '@app/component/next-soup/soup-context';
import {
  openEntityInSplitFromUnifiedList,
  trashEmails,
} from '@app/component/next-soup/utils';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import { ResponsiveBlockToolbar } from '@app/component/ResponsiveBlockToolbar';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import {
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { toast } from '@core/component/Toast/Toast';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import { getActiveCommandByToken, runCommand } from '@core/hotkey/utils';
import CheckIcon from '@icon/regular/check.svg';
import IconShared from '@icon/regular/share.svg';
import TagIcon from '@icon/regular/tag.svg';
import TrashIcon from '@icon/regular/trash.svg';
import {
  EmailPropertiesButton,
  PROPERTIES_DRAWER_ID,
} from './EmailPropertiesModal';
import { useEmailContext } from './EmailContext';
import { useEmailLinksQuery } from '@queries/email/link';

export function TopBar(props: {
  id: string;
  title: string;
  isDraft?: boolean;
}) {
  const propertiesControl = useDrawerControl(PROPERTIES_DRAWER_ID);
  const shareCtx = useShareDialogContext();
  const emailCtx = useEmailContext();
  const soup = useMaybeSoup();
  const linksQuery = useEmailLinksQuery();

  const isInvite = () => {
    const entity = soup?.items.get(props.id);
    return entity?.type === 'email' && entity.hasIcsAttachment === true;
  };

  const isOwnThread = () => {
    const thread = emailCtx.thread();
    const links = linksQuery.data?.links;
    if (!thread || !links) return false;
    return links.some((link) => link.id === thread.link_id);
  };

  const trashThread = () => {
    const thread = emailCtx.thread();
    if (!thread?.db_id) return;

    // Calculate next entity before trashing so we can navigate to it
    const nextEntity = (() => {
      if (!soup) return undefined;
      const currentIndex = soup.focus.index();
      return soup.items.at(currentIndex + 1) ?? soup.items.at(currentIndex - 1);
    })();

    const handle = trashEmails([thread.db_id]);

    if (soup && nextEntity) {
      soup.selection.clear();
      soup.focus.set(nextEntity.id);
      openEntityInSplitFromUnifiedList(nextEntity, {});
    }

    const toastId = toast.success(
      'Moved to Trash',
      undefined,
      {
        text: 'Undo',
        onClick: () => {
          if (toastId != null) toast.dismiss(toastId);
          handle.undo().then(
            () => toast.success('Restored from Trash'),
            () => toast.failure('Failed to restore from Trash')
          );
        },
      },
      10_000
    );

    handle.done.catch(() => {
      toast.failure('Failed to move to Trash');
    });
  };

  const tools: BlockTool[] = [
    {
      label: 'Done',
      icon: CheckIcon,
      action: () => {
        const command = getActiveCommandByToken(TOKENS.entity.action.markDone);
        if (command) {
          runCommand(command);
        } else {
          emailCtx.archiveThread();
        }
      },
      condition: isOwnThread,
    },
    {
      label: 'Trash',
      icon: TrashIcon,
      action: trashThread,
      condition: isOwnThread,
    },
    {
      label: 'Properties',
      icon: TagIcon,
      action: propertiesControl.toggle,
      buttonComponent: () => <EmailPropertiesButton buttonSize="sm" />,
    },
    {
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      divideAbove: true,
      condition: () => ENABLE_EMAIL_SHARING,
      buttonComponent: () => <ShareTrigger />,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          iconType={isInvite() ? 'emailInvite' : 'email'}
          label={props.title}
          badges={
            props.isDraft
              ? [
                  <SplitHeaderBadge
                    text="draft"
                    tooltip="This is a Draft Email"
                  />,
                ]
              : undefined
          }
        />
      </SplitHeaderLeft>

      <ResponsiveBlockToolbar
        tools={tools}
        ops={[]}
        id={props.id}
        itemType="email"
        name={props.title}
      />
    </>
  );
}
