import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  type DocumentPreviewContentProps,
  PopupPreview,
} from '@core/component/DocumentPreview';
import { DocumentPreviewSheet } from '@core/component/DocumentPreviewSheet';
import { HoverCard } from '@core/component/HoverCard';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useNativeSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import {
  $isAgentSessionMentionNode,
  type AgentSessionMentionDecoratorProps,
} from '@macro-inc/lexical-core';
import { useAgentSessionMentionPreview } from '@queries/agent-session/mentions';
import {
  $getNodeByKey,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { createSignal, onMount, Show, Suspense, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import type { AgentSessionMentionHostProp } from '../../decorator-host/agent-session-mention-host';
import { autoRegister } from '../../plugins';
import { AgentSessionMentionLabel } from './AgentSessionMentionLabel';
import { MagicChip } from './MagicChip';

/**
 * Source `importJSON` and `exportComponentProps` hand the stored id, label and
 * mention id over unchanged, so null or omitted values reach this component.
 * A falsy id disables the preview, a falsy label shows the fallback, and the
 * mention id is never read.
 */
export type AgentSessionMentionUIProps = Omit<
  AgentSessionMentionDecoratorProps,
  'id' | 'label' | 'mentionUuid'
> & {
  id?: string | null;
  label?: string | null;
  mentionUuid?: string | null;
} & AgentSessionMentionHostProp;

export function AgentSessionMention(props: AgentSessionMentionUIProps) {
  const wrapper = useContext(LexicalWrapperContext);
  const layout = useSplitLayout();
  // Older documents stored expanded references inside paragraphs. Parsing a
  // saved editor state skips transforms; normalize this node on first mount.
  onMount(() => {
    if (!props.expanded) return;
    if (props.host) {
      props.host.normalize(props.key);
      return;
    }
    wrapper?.editor.update(() => {
      const node = $getNodeByKey(props.key);
      if (!$isAgentSessionMentionNode(node)) return;
      const parent = node.getParent();
      if (parent && !$isRootOrShadowRoot(parent)) node.markDirty();
    });
  });
  // A null or omitted id reads like an empty one: the preview stays off, so
  // nothing below that needs a loaded session can open, expand or link it.
  const sessionId = () => props.id ?? '';
  const query = useAgentSessionMentionPreview(sessionId, () =>
    props.host ? props.host.previewFetchEnabled() : !wrapper?.skipPreviewFetch
  );
  // Guard resource reads: a pending chip must never suspend its editor.
  const preview = () => (query.isSuccess ? query.data : undefined);
  const session = () => {
    const current = preview();
    return current?.access === 'access' ? current.data : undefined;
  };
  // A deleted or private session has nothing to open; its card says which.
  const isUnavailable = () => {
    const access = preview()?.access;
    return access === 'no_access' || access === 'does_not_exist';
  };
  const label = () => {
    const current = preview();
    if (current?.access === 'no_access') return 'Private agent session';
    if (current?.access === 'does_not_exist') return 'Deleted agent session';
    if (query.isError) return 'Agent session unavailable';
    return session()?.name || props.label || 'Agent session';
  };
  const selected = () =>
    props.host
      ? props.host.isSelected(props.key)
      : wrapper?.selection?.type === 'node' &&
        wrapper.selection.nodeKeys.has(props.key);
  const [previewCardOpen, setPreviewCardOpen] = createSignal(false);
  const [previewSheetOpen, setPreviewSheetOpen] = createSignal(false);
  const open = (event: MouseEvent | KeyboardEvent | null) => {
    if (isUnavailable()) {
      if (isTouchDevice()) setPreviewSheetOpen(true);
      else setPreviewCardOpen(true);
      return;
    }
    if (!session()) return;
    layout?.openWithSplit(
      { type: 'agent', id: sessionId() },
      {
        preferNewSplit: openInNewSplitForMention(
          event?.shiftKey,
          event !== null
        ),
      }
    );
  };
  const onEnter = (event: KeyboardEvent | null) => {
    if (!selected() || !(session() || isUnavailable())) return false;
    open(event);
    return true;
  };
  if (props.host) autoRegister(props.host.registerNormalEnter(onEnter));
  else if (wrapper?.editor)
    autoRegister(
      wrapper.editor.registerCommand(
        KEY_ENTER_COMMAND,
        onEnter,
        COMMAND_PRIORITY_NORMAL
      )
    );
  const navigation = useNativeSplitNavigationHandler<HTMLSpanElement>(
    (event) => {
      event.stopPropagation();
      open(event);
    }
  );
  const canExpand = () =>
    Boolean(
      session() &&
        (props.host ? props.host.isInteractable() : wrapper?.isInteractable())
    );
  const setExpanded = (expanded: boolean) => {
    if (!canExpand()) return;
    if (props.host) {
      props.host.setExpanded(props.key, expanded);
      return;
    }
    wrapper?.editor.update(() => {
      const node = $getNodeByKey(props.key);
      if ($isAgentSessionMentionNode(node)) node.setExpanded(expanded);
    });
  };
  // One set of preview props for the hover card and the touch sheet.
  const previewContentProps: DocumentPreviewContentProps = {
    get documentInfo(): DocumentPreviewContentProps['documentInfo'] {
      return {
        id: sessionId(),
        type: 'agent',
        params: {},
        isOpenable: true,
      };
    },
    get previewInfo() {
      return {
        isPreviewable: false,
        showPreview: canExpand(),
        handlePreviewToggle: () => setExpanded(true),
      };
    },
  };

  return (
    <Show
      when={props.expanded && session()}
      fallback={
        <>
          <Show
            when={isTouchDevice() && (isUnavailable() || previewSheetOpen())}
          >
            <DocumentPreviewSheet
              open={previewSheetOpen()}
              onOpenChange={setPreviewSheetOpen}
              {...previewContentProps}
            />
          </Show>
          <HoverCard
            disabled={!session() && !isUnavailable()}
            open={previewCardOpen()}
            onOpenChange={setPreviewCardOpen}
            keepOpenOnTriggerPress={isUnavailable()}
            trigger={
              <span
                data-agent-session-mention="true"
                data-agent-session-id={props.id}
                data-agent-session-label={label()}
                class="py-0.5 rounded-xs hover:bg-hover focus:bg-active"
                classList={{ 'bg-active': selected() }}
                title={label()}
                {...navigation}
              >
                <AgentSessionMentionLabel label={label()} />
              </span>
            }
            content={
              <Suspense>
                <PopupPreview
                  mouseEnter={() => {}}
                  mouseLeave={() => {}}
                  {...previewContentProps}
                />
              </Suspense>
            }
          />
        </>
      }
    >
      <div class="block w-full" data-agent-session-expanded="true">
        <Suspense>
          <MagicChip
            host={props.host?.magic}
            key={props.key}
            agentSessionId={sessionId()}
            promptedMessage={null}
            status="no_messages"
            onCollapse={canExpand() ? () => setExpanded(false) : undefined}
          />
        </Suspense>
      </div>
    </Show>
  );
}
