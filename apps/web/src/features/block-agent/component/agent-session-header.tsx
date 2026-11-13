import { useBlockEntityCommands } from '@app/features/next-soup/actions/use-block-entity-commands';
import type { BlockTool } from '@components/app/block-tool';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { Permissions } from '@core/component/SharePermissions';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { openExternalUrl } from '@core/util/url';
import type { AgentSessionEntity } from '@entity';
import ShareIcon from '@icon/share.svg';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import GitBranch from '@icon/system/regular/git-branch.svg';
import TrayIcon from '@icon/system/regular/tray.svg';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { isSessionArchived } from '@service-agent-harness/session-archive';
import type { Accessor } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import { changeSessionArchiveState } from '../queries/change-session-archive-state';
import { useAutoArchiveFileOperations } from './auto-archive-file-operations';
import {
  sessionHarnessTitle,
  sessionRepositoryUrl,
} from './compose-agent-session-options';

export function agentSessionFileOperations(
  session: AgentSessionResponse | undefined,
  permissions: Permissions,
  setArchived: () => void,
  autoArchive: FileOperation[]
): FileOperation[] {
  const repositoryUrl = sessionRepositoryUrl(session);
  const archived = isSessionArchived(session);
  return [
    ...(!archived ? [{ op: 'rename' } as const] : []),
    ...(permissions === Permissions.OWNER
      ? [
          {
            label: archived ? 'Unarchive' : 'Archive',
            icon: TrayIcon,
            action: setArchived,
          },
          ...autoArchive,
        ]
      : []),
    { op: 'delete' },
    ...(repositoryUrl
      ? [
          {
            label: 'Open repository',
            icon: GitBranch,
            action: () => openExternalUrl(repositoryUrl),
          },
        ]
      : []),
  ];
}

/** Shared title precedence for standalone and workspace agent sessions. */
export function agentSessionTitle(
  session: AgentSessionResponse | undefined,
  transcriptTitle?: string | null
): string {
  const name = session?.name;
  if (name && name !== 'Agent Session') return name;
  return transcriptTitle ?? name ?? sessionHarnessTitle(session ?? {});
}

/** What both agent session headers show and act on. */
export type AgentSessionHeaderState = {
  title: Accessor<string>;
  entity: Accessor<AgentSessionEntity | undefined>;
  permissions: Accessor<Permissions>;
  openShare: () => void;
  ops: Accessor<FileOperation[]>;
  /** Every session action by name. Each view lists the ones it offers. */
  actions: { openExternally: BlockTool; share: BlockTool };
};

/**
 * The session's identity, access and actions for its header. Rename lives on
 * the title menu (channel / routine), not on a tap of the name.
 */
export function useAgentSessionHeader(props: {
  session: Accessor<AgentSessionResponse | undefined>;
  /** The fold's session title, preferred over the harness fallback. */
  title: Accessor<string | undefined>;
}): AgentSessionHeaderState {
  // The session, not `useBlockId()`: a block created from the launcher mounts
  // against a placeholder and keeps reporting it (see `Block.tsx`), so the
  // block id is the one thing here that is not a shareable session id.
  const { sessionId, userId } = useAgentSession();
  const title = () => agentSessionTitle(props.session(), props.title());
  const permissions = () =>
    userId() && props.session()?.ownerId === userId()
      ? Permissions.OWNER
      : props.session()?.canEdit
        ? Permissions.CAN_EDIT
        : Permissions.CAN_VIEW;

  const entity = (): AgentSessionEntity | undefined => {
    const session = props.session();
    const id = sessionId();
    if (!session || !id) return undefined;
    return {
      type: 'agent_session',
      id,
      name: title(),
      archivedBy: session.archivedBy,
      archivedAt: session.archivedAt,
      ownerId: session.ownerId,
      botId: session.botId,
      status:
        session.status.kind === 'event'
          ? session.status.event
          : session.status.kind,
    };
  };
  useBlockEntityCommands({ resolveEntity: entity });
  const openShare = useShareModal(() => {
    const session = entity();
    if (!session) return;
    return {
      id: session.id,
      name: title(),
      owner: session.ownerId,
      itemType: 'agent_session',
      blockAlias: 'agent',
      userPermissions: permissions(),
    };
  });

  const actions = {
    openExternally: {
      label: () => {
        const provider = props.session()?.external?.provider;
        if (!provider) return 'Open externally';
        return `Open in ${provider.charAt(0).toUpperCase()}${provider.slice(1)}`;
      },
      icon: ArrowSquareOut,
      action: () => {
        const url = props.session()?.external?.url;
        if (url) openExternalUrl(url);
      },
      condition: () => Boolean(props.session()?.external?.url),
    },
    share: {
      label: 'Share',
      icon: ShareIcon,
      action: openShare,
      condition: () => Boolean(entity()),
    },
  } satisfies Record<string, BlockTool>;

  const setArchived = async () => {
    const id = sessionId();
    const session = props.session();
    if (!id || !session) return;
    await changeSessionArchiveState(id, !isSessionArchived(session));
  };
  const autoArchive = useAutoArchiveFileOperations({
    sessionId,
    enabled: () => {
      const session = props.session();
      return (
        permissions() === Permissions.OWNER &&
        session !== undefined &&
        !isSessionArchived(session)
      );
    },
  });
  const ops = () =>
    entity()
      ? agentSessionFileOperations(
          props.session(),
          permissions(),
          setArchived,
          autoArchive()
        )
      : [];

  return { title, entity, permissions, openShare, ops, actions };
}
