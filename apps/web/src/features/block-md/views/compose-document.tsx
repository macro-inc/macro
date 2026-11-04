import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { toast } from '@core/component/Toast/Toast';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowsOutIcon from '@icon/system/regular/arrows-out.svg';
import XIcon from '@icon/system/regular/x.svg';
import { InlineTagsPill } from '@property/tags';
import type { PropertyApiValues } from '@property/types';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { Button, EntityComposer } from '@ui';
import { createSignal, onMount, Show, Suspense } from 'solid-js';
import { DocumentFields } from '../../document-composer/components/document-fields';
import { createDocumentEditor } from '../../document-composer/primitives/create-document-editor';
import type { ComposeTaskSuccess } from '../../task-composer/core/types';
import { createDocumentWithTags } from '../queries/create-document-with-tags';
import { createDocumentComposerTags } from '../util/documentComposerProperties';

export interface ComposeDocumentProps {
  initialTitle?: string;
  initialContent?: string;
  initialTags?: Record<string, PropertyApiValues>;
  onCreateStart?: (init: { title: string; content: string }) => void;
  onCreateFailure?: () => void;
  onSuccess?: (result: ComposeTaskSuccess) => void | Promise<void>;
}

/** Slash-command composer; the main Create → Document entry point stays direct. */
export function ComposeDocument(props: ComposeDocumentProps) {
  const panel = useSplitPanelOrThrow();
  const { popoverSplit, openWithSplit } = useSplitLayout();
  const [title, setTitle] = createSignal(props.initialTitle ?? '');
  const [content, setContent] = createSignal(props.initialContent ?? '');
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const [isCreating, setIsCreating] = createSignal(false);
  const [attachHotkeys, scope] = useHotkeyDOMScope('compose-document', true);
  const tags = createDocumentComposerTags(props.initialTags);
  const history = useUpsertToHistoryMutation();
  const portalScope = () => (panel.handle.isPopover() ? 'local' : 'block');

  const submit = async (expand = false) => {
    const documentTitle =
      title().trim() || (expand ? blockNameToDefaultFile('md') : '');
    if (isCreating() || !documentTitle) return;
    const documentContent = content().trim();
    const entries = tags.tagEntries();
    const definitions = tags.createDefinitions();
    setIsCreating(true);
    let split: ReturnType<typeof openWithSplit>['split'];

    // Keep the original insertion callbacks when retrying a failed request.
    const reopen = () => {
      split?.goBack();
      props.onCreateFailure?.();
      popoverSplit({
        type: 'component',
        id: 'document-compose',
        params: {
          ...props,
          initialTitle: documentTitle,
          initialContent: documentContent,
          initialTags: Object.fromEntries(entries),
        },
      });
    };

    let created: Awaited<ReturnType<typeof createDocumentWithTags>>;
    try {
      created = await createDocumentWithTags(
        documentTitle,
        documentContent,
        entries,
        definitions,
        (params) => history.mutate(params),
        {
          onMutate: () => {
            panel.handle.close();
            props.onCreateStart?.({
              title: documentTitle,
              content: documentContent,
            });
            if (expand) {
              split = openWithSplit(
                { type: 'component', id: 'loading' },
                { referredFrom: 'launcher', preferNewSplit: true }
              ).split;
            }
          },
        }
      );
    } catch {
      toast.failure('Failed to create Document');
      reopen();
      return;
    }
    if (!created) {
      reopen();
      return;
    }
    split?.replace({
      next: { type: 'md', id: created.documentId },
      mergeHistory: true,
      referredFrom: 'launcher',
    });
    await props.onSuccess?.({
      documentId: created.documentId,
      title: documentTitle,
      content: documentContent,
    });
  };

  let submitButton: HTMLButtonElement | undefined;
  const editorConfig = createDocumentEditor({
    resolveAppLink: useMacroMentionLinkResolver(),
    tags: tags.composerTags,
    onChange: setContent,
  })
    .onFocusLeave({
      onStart: () => titleRoot?.focus(),
      onEnd: () => submitButton?.focus(),
    })
    .onEscape(() => {
      container()?.focus();
      return true;
    });
  let titleRoot: HTMLDivElement | undefined;

  onMount(() => {
    panel.handle.setDisplayName('New document');
    const root = container();
    if (root) attachHotkeys(root);
  });
  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: scope,
    description: 'Create document',
    keyDownHandler: () => {
      fireAndForget(submit(), 'compose-document');
      return true;
    },
    runWithInputFocused: true,
  });

  return (
    <EntityComposer.Root tabIndex={-1} ref={setContainer}>
      <EntityComposer.Header>
        <div class="flex-1 flex items-center">
          <Show when={panel.handle.isPopover()}>
            <Button
              variant="ghost"
              onMouseDown={() =>
                fireAndForget(submit(true), 'compose-document')
              }
              disabled={isCreating()}
              tabIndex={-1}
              tooltip="Continue editing in split"
              size="icon-md"
            >
              <ArrowsOutIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
            </Button>
          </Show>
        </div>
        <Button
          variant="ghost"
          onClick={() => panel.handle.close()}
          tabIndex={-1}
          tooltip="Close"
          size="icon-md"
        >
          <XIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
      </EntityComposer.Header>
      <DocumentFields
        title={title()}
        onTitleChange={setTitle}
        editor={editorConfig}
        initialValue={props.initialContent || undefined}
        disabled={isCreating()}
        containerRef={container}
        titleRef={(root) => {
          titleRoot = root;
        }}
        onTagSelected={(tag) => {
          fireAndForget(
            tags.composerTags.applyTag(tag.scope, tag.optionId),
            'compose-document'
          );
        }}
        portalScope={portalScope()}
      />
      <EntityComposer.Footer class="items-center">
        <Suspense fallback={<div class="h-7" />}>
          <InlineTagsPill docTags={tags.composerTags} showPlaceholder />
        </Suspense>
        <EntityComposer.Submit
          ref={(button) => {
            submitButton = button;
          }}
          variant="primary"
          onClick={() => fireAndForget(submit(), 'compose-document')}
          disabled={!title().trim() || isCreating()}
          hasContent={!!title().trim()}
        >
          Create Document
        </EntityComposer.Submit>
      </EntityComposer.Footer>
    </EntityComposer.Root>
  );
}
