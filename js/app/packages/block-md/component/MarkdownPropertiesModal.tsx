import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import { useBlockAliasedName } from '@core/block';
import { LabelAndHotKey } from '@core/component/Tooltip';
import { Button } from '@ui';
import {
  $getPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  REMOVE_PINNED_PROPERTY_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import { PropertiesView } from '@core/component/Properties/PropertiesView';
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import TagIcon from '@icon/regular/tag.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createEffect, createSignal, Suspense } from 'solid-js';
import { mdStore } from '../signal/markdownBlockData';

export const DRAWER_ID = 'properties';

export function MarkdownPropertiesButton(props: {
  buttonSize?: 'sm' | 'base';
}) {
  const drawerControl = useDrawerControl(DRAWER_ID);
  return (
    <Button
      variant={drawerControl.isOpen() ? 'active' : 'ghost'}
      size={props.buttonSize === 'sm' ? 'icon-sm' : 'icon-md'}
      tooltip={<LabelAndHotKey label="Properties" />}
      onClick={drawerControl.toggle}
    >
      <TagIcon />
    </Button>
  );
}

export function MarkdownPropertiesDrawer(props: { documentId: string }) {
  return (
    <SplitDrawer id={DRAWER_ID} side="right" size={550} title="Properties">
      <Suspense fallback={<LoadingFallback />}>
        <MarkdownPropertiesContent documentId={props.documentId} />
      </Suspense>
    </SplitDrawer>
  );
}

export function MarkdownPropertiesModal(props: {
  documentId: string;
  buttonSize?: 'sm' | 'base';
}) {
  const drawerControl = useDrawerControl(DRAWER_ID);

  return (
    <>
      <Button
        variant={drawerControl.isOpen() ? 'active' : 'ghost'}
        size={props.buttonSize === 'sm' ? 'icon-sm' : 'icon-md'}
        tooltip={<LabelAndHotKey label="Properties" />}
        onClick={drawerControl.toggle}
      >
        <TagIcon />
      </Button>
      <SplitDrawer id={DRAWER_ID} side="right" size={550} title="Properties">
        <Suspense fallback={<LoadingFallback />}>
          <MarkdownPropertiesContent documentId={props.documentId} />
        </Suspense>
      </SplitDrawer>
    </>
  );
}

function MarkdownPropertiesContent(_props: { documentId: string }) {
  const canEdit = useCanEdit();
  const documentName = useBlockDocumentName();
  const mdData = mdStore.get; // Access block store at component level

  const blockName = useBlockAliasedName();
  const entityType: EntityType = blockName === 'task' ? 'TASK' : 'DOCUMENT';

  // Track pinned property IDs from Lexical - reactively updates on editor state changes
  const [pinnedPropertyIds, setPinnedPropertyIds] = createSignal<string[]>([]);

  // Set up reactive listener for Lexical state changes
  createEffect(() => {
    const currentEditor = mdData.editor; // Use the block store reference
    if (!currentEditor) return;

    // Initial load - read from current editor state
    currentEditor.getEditorState().read(() => {
      const ids = $getPinnedProperties();
      setPinnedPropertyIds(ids);
    });

    // Register listener for state updates (including from other users)
    const unregister = currentEditor.registerUpdateListener(
      ({ editorState }) => {
        editorState.read(() => {
          const ids = $getPinnedProperties();
          setPinnedPropertyIds(ids);
        });
      }
    );

    return () => {
      unregister();
    };
  });

  const handlePropertyPinned = (propertyId: string) => {
    const editor = mdData.editor;
    if (editor) {
      editor.dispatchCommand(ADD_PINNED_PROPERTY_COMMAND, propertyId);
    }
  };

  const handlePropertyUnpinned = (propertyId: string) => {
    const editor = mdData.editor;
    if (editor) {
      editor.dispatchCommand(REMOVE_PINNED_PROPERTY_COMMAND, propertyId);
    }
  };

  return (
    <div class="flex flex-col h-full text-sm">
      {/* Future: Add markdown-specific sections here */}
      {/* e.g., word count, reading time, headings outline, etc. */}

      <PropertiesView
        blockType="md"
        canEdit={canEdit()}
        entityType={entityType}
        documentName={documentName()}
        onPropertyPinned={handlePropertyPinned}
        onPropertyUnpinned={handlePropertyUnpinned}
        pinnedPropertyIds={pinnedPropertyIds}
      />
    </div>
  );
}

function LoadingFallback() {
  return (
    <div class="flex justify-center items-center py-8">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-ink-muted"></div>
    </div>
  );
}
