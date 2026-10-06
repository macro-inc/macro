import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { toast } from '@core/component/Toast/Toast';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import ArrowsOutIcon from '@phosphor/arrows-out.svg';
import XIcon from '@phosphor/x.svg';
import { InlineTagsPill } from '@property/tags';
import type { PropertyApiValues } from '@property/types';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { Button, EntityComposer, Scroll } from '@ui';
import { createSignal, onMount, Show, Suspense } from 'solid-js';
import type { ComposeTaskSuccess } from '../component/ComposeTask';
import { ComposeTaskTitleEditor } from '../component/ComposeTask';
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
  const editorConfig = buildConfig('markdown')
    .withAppLinkResolver(useMacroMentionLinkResolver())
    .withMentions()
    .withTags({
      applyTargetLabel: 'Document',
      isApplied: (tag) => tags.composerTags.isApplied(tag.optionId),
      onCreate: (tag) => {
        void tags.composerTags.applyTag(tag.scope, tag.optionId);
      },
    })
    .withEmojis()
    .withActions()
    .withCode()
    .withMedia({ fileDrop: true })
    .withSelectionData()
    .withFloatingFormatMenu()
    .withHistory()
    .onChange(setContent)
    .onFocusLeave({
      onStart: () => titleRoot?.focus(),
      onEnd: () => submitButton?.focus(),
    })
    .onEscape(() => {
      container()?.focus();
      return true;
    });
  const editor = editorConfig.buildHandle().lexical;
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
      void submit();
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
              onMouseDown={() => void submit(true)}
              disabled={isCreating()}
              tabIndex={-1}
              tooltip="Continue editing in split"
              size="icon-composer"
            >
              <ArrowsOutIcon />
            </Button>
          </Show>
        </div>
        <Button
          onClick={() => panel.handle.close()}
          tabIndex={-1}
          tooltip="Close"
          size="icon-composer"
        >
          <XIcon />
        </Button>
      </EntityComposer.Header>
      <EntityComposer.Main>
        <EntityComposer.Title>
          <ComposeTaskTitleEditor
            placeholder="New document"
            value={title}
            onChange={setTitle}
            disabled={isCreating}
            bodyEditor={() => editor}
            containerRef={container}
            onUserInput={() => {}}
            onTagSelected={(tag) => {
              void tags.composerTags.applyTag(tag.scope, tag.optionId);
            }}
            onDeleteTagsAtStart={() => false}
            portalScope={portalScope()}
            ref={(root) => {
              titleRoot = root;
            }}
          />
        </EntityComposer.Title>
        <EntityComposer.Body>
          <Scroll>
            <MarkdownShell
              config={editorConfig}
              initialValue={props.initialContent || undefined}
              placeholder="Add content..."
              portalScope={portalScope()}
            />
          </Scroll>
        </EntityComposer.Body>
      </EntityComposer.Main>
      <EntityComposer.Footer class="items-center">
        <Suspense fallback={<div class="h-7" />}>
          <InlineTagsPill docTags={tags.composerTags} showPlaceholder />
        </Suspense>
        <EntityComposer.Submit
          ref={(button) => {
            submitButton = button;
          }}
          variant="strong"
          onClick={() => void submit()}
          disabled={!title().trim() || isCreating()}
          hasContent={!!title().trim()}
        >
          Create Document
        </EntityComposer.Submit>
      </EntityComposer.Footer>
    </EntityComposer.Root>
  );
}
