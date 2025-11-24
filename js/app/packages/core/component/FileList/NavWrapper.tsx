import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { SplitPanelContext } from '@app/component/split-layout/context';
import type { BlockName } from '@core/block';
import { isRightPanelOpen, useToggleRightPanel } from '@core/signal/layout';
import { rightbarOpenOnce, setRightbarOpenOnce } from '@core/signal/rightbar';
import { isErr } from '@core/util/maybeResult';
import { markNotificationForEntityIdAsRead } from '@notifications';
import {
  type ItemType,
  isCloudStorageItem,
  storageServiceClient,
} from '@service-storage/client';
import type { Project } from '@service-storage/generated/schemas/project';
import { postNewHistoryItem } from '@service-storage/history';
import {
  type AnchorProps,
  useLocation,
  useNavigate,
  useSearchParams,
} from '@solidjs/router';
import { createMemo, type JSX, useContext } from 'solid-js';

export function NavWrapper(
  props: AnchorProps & {
    openInSplit?: boolean;
    id: string;
    itemType: ItemType;
    blockName: BlockName;
    insideProjectBlock?: boolean;
    doubleClickNav?: boolean;
    setBlockProject?: (project: Project) => void;
    selectionOnly?: boolean;
    focusBorderInset?: number;
  }
): JSX.Element {
  const notificationSource = useGlobalNotificationSource();
  const navigate = useNavigate();
  const location = useLocation();
  const [_searchParams, setSearchParams] = useSearchParams();
  const isRightPanelCollapsed = () => !isRightPanelOpen();
  const toggleRightPanel = useToggleRightPanel();

  const splitPanelContext = useContext(SplitPanelContext);

  const isActive = createMemo(() => {
    const path = location.pathname;
    const isExact = path === props.href;

    if (props.end) {
      return isExact;
    }

    return isExact || (props.href !== '/' && path.includes(props.href));
  });

  const className = createMemo(() => {
    const baseClassName = props.class || '';
    const activeStateClass =
      isActive() && !props.selectionOnly
        ? props.activeClass
        : props.inactiveClass;
    return [baseClassName, activeStateClass].filter(Boolean).join(' ');
  });

  const rightPanelDisallowedBlocks = ['channel', 'project', 'chat'];

  const handleNav = async (e: MouseEvent) => {
    console.log('handleNav', props.href);
    if (e.shiftKey && props.itemType !== 'channel') {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    if (e.button === 1) {
      // const fullPath = `/app${props.href}`;
      // window.open(fullPath, '_blank', 'noopener,noreferrer');
      // return;
    }

    if (props.id === 'trash') {
      navigate(props.href, {
        state: props.state,
        replace: props.replace || false,
        scroll: !props.noScroll,
      });
    } else if (props.insideProjectBlock) {
      // If we are inside a project block, and navigating to a project, we need to set the query param, and update the block project signal
      if (props.itemType === 'project') {
        const maybeProjectResponse =
          await storageServiceClient.projects.getProject({
            id: props.id,
          });
        if (isErr(maybeProjectResponse)) {
          return console.error(maybeProjectResponse);
        }
        const [, projectResponse] = maybeProjectResponse;
        const project = projectResponse.projectMetadata;
        props.setBlockProject?.(project);
        setSearchParams({ projectId: props.id });
      } else {
        splitPanelContext?.handle.replace({
          type: props.blockName,
          id: props.id,
        });
      }
    } else if (props.openInSplit) {
      splitPanelContext?.handle.replace({
        type: props.blockName,
        id: props.id,
      });
    } else {
      if (
        rightbarOpenOnce() &&
        !rightPanelDisallowedBlocks.includes(props.blockName)
      ) {
        if (isRightPanelCollapsed()) {
          toggleRightPanel?.();
        }
        setRightbarOpenOnce(false);
      }

      splitPanelContext?.handle.replace({
        type: props.blockName,
        id: props.id,
      });
    }

    if (props.itemType !== 'channel') {
      markNotificationForEntityIdAsRead(notificationSource, props.id);
    }
    if (e.button === 0) {
      if (props.href) {
        if (isCloudStorageItem(props.itemType)) {
          postNewHistoryItem(props.itemType, props.id);
        }
      }
    }
  };

  return (
    <a
      href={props.selectionOnly ? undefined : `/app${props.href}`}
      class={
        className() +
        ' cursor-default ' +
        // Prevents children inheriting custom property change since only one element can recieve focus at a time
        '[&:focus]:[--focus-border-inset:var(--prop_focus-border-inset)]'
      }
      style={{
        '--prop_focus-border-inset': `${props.focusBorderInset ?? 4}px`,
      }}
      // href={props.selectionOnly ? undefined : `/app${props.href}`}
      data-nav-id={props.id}
      onClick={
        props.doubleClickNav
          ? undefined
          : props.selectionOnly
            ? undefined
            : handleNav
      }
      onAuxClick={props.selectionOnly ? undefined : handleNav}
      onDblClick={
        props.doubleClickNav
          ? props.selectionOnly
            ? undefined
            : handleNav
          : undefined
      }
      draggable={false}
    >
      {props.children}
    </a>
  );
}
