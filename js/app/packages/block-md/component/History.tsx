import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import {
  type GroupedHistory,
  type GroupingConfig,
  getDocumentHistory,
} from '@core/collab/time-travel';
import { IconButton } from '@core/component/IconButton';
import {
  createLexicalWrapper,
  type LexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  codePlugin,
  horizontalRulePlugin,
  mediaPlugin,
  tablePlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { initializeEditorWithState } from '@core/component/LexicalMarkdown/utils';
import { TextButton } from '@core/component/TextButton';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon } from '@core/component/UserIcon';
import { TOKENS } from '@core/hotkey/tokens';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { isErr } from '@core/util/maybeResult';
import ClockIcon from '@icon/regular/clock-counter-clockwise.svg';
import {
  CommentNode,
  CustomCodeNode,
  InlineSearchNode,
  peerIdPlugin,
} from '@lexical-core';
import { storageServiceClient } from '@service-storage/client';
import type { SyncServiceVersionID } from '@service-storage/generated/schemas/syncServiceVersionID';
import { registerHotkey } from 'core/hotkey/hotkeys';
import type { SerializedEditorState } from 'lexical';
import { LoroDoc } from 'loro-crdt';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onMount,
  type ResourceReturn,
  Show,
  Suspense,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { syncServiceClient } from '../../service-sync/client';

const DRAWER_ID = 'history';

async function forkDocumentAtVersion(
  documentId: string,
  documentName: string,
  version: SyncServiceVersionID
) {
  const newName = `${documentName} (forked)`;
  const response = await storageServiceClient.copyDocument({
    documentId,
    documentName: newName,
    syncServiceVersion: version,
  });

  if (isErr(response)) return;

  const [, data] = response;

  return data.documentId;
}

async function getLoroDocFromId(documentId: string) {
  const maybeSnapshot = await syncServiceClient.getSnapshot({
    documentId: documentId,
  });

  const doc = new LoroDoc();

  if (isErr(maybeSnapshot)) {
    console.error("Couldn't get snapshot", maybeSnapshot);
    return doc;
  }

  const [, snapshot] = maybeSnapshot;

  doc.import(snapshot);
  return doc;
}

export function HistoryModal(props: { documentId: string }) {
  const drawerControl = useDrawerControl(DRAWER_ID);

  return (
    <>
      <IconButton
        tooltip={{ label: 'History' }}
        icon={ClockIcon}
        theme={drawerControl.isOpen() ? 'accent' : 'clear'}
        size="sm"
        onClick={drawerControl.toggle}
      />
      <SplitDrawer id={DRAWER_ID} side="right" size={768} title="History">
        <Suspense fallback={'loading...'}>
          <History
            documentId={props.documentId}
            close={drawerControl.close}
            isOpen={drawerControl.isOpen()}
          />
        </Suspense>
      </SplitDrawer>
    </>
  );
}

type HistoryProps = {
  documentId: string;
  close: () => void;
  isOpen: boolean;
};

type VersionId = {
  peerId: `${number}`;
  counter: number;
};

export function History(props: HistoryProps) {
  const [selectedVersion, setSelectedVersion] = createSignal<VersionId>();
  const context = useSplitPanelOrThrow();
  const { insertSplit } = useSplitLayout();
  const [loroDoc] = createResource(async () =>
    getLoroDocFromId(props.documentId)
  );

  const [isForking, setIsForking] = createSignal(false);

  const documentName = useBlockDocumentName();

  const [historyData] = createHistoryResource(props.documentId);

  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'md',
    isInteractable: () => false,
  });

  const sortedHistory = createMemo(() => {
    const data = historyData();
    if (!data || data.length === 0) return [];

    return data.sort(
      (a, b) => b.representative.timestamp - a.representative.timestamp
    );
  });

  createEffect(() => {
    if (historyData.loading || historyData.error) return;
    if (loroDoc.loading || loroDoc.error) return;

    let representative = historyData()?.at(0)?.representative;
    if (!representative) return;

    let versionId = {
      peerId: representative.change.peer,
      counter: representative.change.counter,
    };
    setSelectedVersion(versionId);
    selectVersion(versionId);
  });

  const selectVersion = (version: VersionId) => {
    const loroDoc_ = loroDoc();
    setSelectedVersion(version);
    if (!loroDoc_) {
      console.error('loroDoc_ is undefined');
      return;
    }

    const state = getStateAtVersion(loroDoc_, version);

    if (state === 'serialization-error') {
      toast.failure('Failed to parse state');
      return;
    }

    initializeEditorWithState(lexicalWrapper.editor, state);
  };

  const selected: () => [GroupedHistory, number] | undefined = () => {
    if (!selectedVersion()) return undefined;

    const found = sortedHistory()?.find(
      (v) =>
        v.representative.change.peer === selectedVersion()!.peerId &&
        v.representative.change.counter === selectedVersion()!.counter
    );

    if (!found) return undefined;

    return [found, sortedHistory()!.indexOf(found)!];
  };

  const handleFork = async () => {
    if (!selected()) return;
    const rep = selected()![0].representative;
    setIsForking(true);
    const id = await forkDocumentAtVersion(props.documentId, documentName(), {
      counter: rep.change.counter,
      peer: rep.change.peer,
    });
    if (!id) {
      toast.failure('Failed to copy version');
      setIsForking(false);
      return;
    }
    insertSplit({
      type: 'md',
      id,
    });
    setIsForking(false);
  };

  return (
    <div
      class="w-full h-full p-2 flex flex-col gap-2 pb-12 suppress-css-bracket"
      tabindex={-1}
    >
      <Suspense fallback={'loading...'}>
        <Show when={selectedVersion()}>
          {(selectedVersion) => {
            return (
              <>
                <Show when={selected()}>
                  {(selected) => {
                    return (
                      <div class="flex justify-between items-center w-full border border-edge">
                        <VersionListItem
                          item={selected()[0]}
                          isSelected={true}
                          index={selected()[1]}
                          total={sortedHistory()!.length}
                        />
                        <div class="pr-4">
                          <TextButton
                            text="Copy Version"
                            theme="accent"
                            disabled={isForking()}
                            onClick={handleFork}
                          />
                        </div>
                      </div>
                    );
                  }}
                </Show>
                <div
                  class="w-full h-[50%] overflow-y-scroll border border-edge suppress-css-bracket"
                  tabindex={-1}
                  ref={(ref) => {
                    ref.focus();
                  }}
                >
                  <DocumentPreview
                    selectedVersion={selectedVersion()}
                    lexicalWrapper={lexicalWrapper}
                    isSelectedVersionEmpty={false}
                  />
                </div>
                <div
                  class="w-full h-[50%] overflow-y-auto border border-edge"
                  tabindex={-1}
                >
                  <VersionList
                    versions={sortedHistory()!}
                    selectedVersion={selectedVersion()}
                    handleSelect={selectVersion}
                    scopeId={context.splitHotkeyScope}
                    isOpen={props.isOpen}
                  />
                </div>
              </>
            );
          }}
        </Show>
      </Suspense>
    </div>
  );
}

const GROUPING_CONFIG: GroupingConfig = {
  pauseThreshold: 5000,
  minChanges: 1,
};

function isSerializedEditorState(
  state: unknown | undefined
): state is SerializedEditorState {
  return (
    state !== undefined &&
    state !== null &&
    typeof state === 'object' &&
    'root' in state
  );
}

type StateError = 'serialization-error';

function getStateAtVersion(
  loroDoc: LoroDoc,
  version: VersionId
): SerializedEditorState | StateError {
  loroDoc.checkout([{ peer: version.peerId, counter: version.counter }]);

  const loroState = loroDoc.toJSON();

  if (!isSerializedEditorState(loroState)) {
    return 'serialization-error';
  }

  return loroState;
}

function createHistoryResource(
  documentId: string
): ResourceReturn<GroupedHistory[]> {
  return createResource(async () => {
    const data = await getDocumentHistory(documentId, {
      grouping: GROUPING_CONFIG,
    });
    return data as GroupedHistory[];
  });
}

function DocumentPreview(props: {
  selectedVersion: VersionId;
  lexicalWrapper: LexicalWrapper;
  isSelectedVersionEmpty: boolean;
}) {
  let mountRef!: HTMLDivElement;

  onMount(() => {
    if (!mountRef) return;
    props.lexicalWrapper.editor.setRootElement(mountRef);
    props.lexicalWrapper.editor.setEditable(false);
  });

  props.lexicalWrapper.plugins
    .richText()
    .list()
    .markdownShortcuts()
    .use(horizontalRulePlugin())
    .use(mediaPlugin())
    .use(
      tablePlugin({
        hasCellMerge: true,
        hasCellBackgroundColor: true,
        hasTabHandler: false,
        hasHorizontalScroll: false,
      })
    )
    .use(
      codePlugin({
        setAccessories: (..._props: any) => {},
        accessories: {},
      })
    )
    .use(
      peerIdPlugin({
        peerId: () => undefined,
        nodes: [InlineSearchNode, CommentNode, CustomCodeNode],
      })
    );

  return (
    <div class="w-full h-full supress-css-bracket p-2">
      <LexicalWrapperContext.Provider value={props.lexicalWrapper}>
        <Show when={props.isSelectedVersionEmpty}>
          <div class="w-full h-full flex items-center justify-center">
            <p class="text-ink-placeholder italic">
              This version of the document is empty
            </p>
          </div>
        </Show>
        <div class="w-full h-full" ref={mountRef} contentEditable={false} />
      </LexicalWrapperContext.Provider>
    </div>
  );
}

function moveUp(
  versions: GroupedHistory[],
  current: VersionId
): VersionId | null {
  const idx = findVersionIndex(versions, current);
  if (idx <= 0) return null;
  return toVersionId(versions[idx - 1]);
}

function moveDown(
  versions: GroupedHistory[],
  current: VersionId
): VersionId | null {
  const idx = findVersionIndex(versions, current);
  if (idx >= versions.length - 1) return null;
  return toVersionId(versions[idx + 1]);
}

function findVersionIndex(
  versions: GroupedHistory[],
  version: VersionId
): number {
  return versions.findIndex(
    (v) =>
      v.representative.change.peer === version.peerId &&
      v.representative.change.counter === version.counter
  );
}

function toVersionId(item: GroupedHistory): VersionId {
  return {
    peerId: item.representative.change.peer,
    counter: item.representative.change.counter,
  };
}

function VersionList(props: {
  versions: GroupedHistory[];
  selectedVersion: VersionId;
  handleSelect: (version: VersionId) => void;
  scopeId: string;
  isOpen: boolean;
}) {
  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();

  onMount(() => {
    registerHotkey({
      hotkey: 'arrowup',
      scopeId: props.scopeId,
      description: 'Next version',
      condition: () => props.isOpen,
      keyDownHandler: () => {
        const current = props.selectedVersion;
        const next = moveUp(props.versions, current);
        virtualHandle()?.scrollToIndex(
          findVersionIndex(props.versions, next ?? current),
          {
            align: 'nearest',
          }
        );
        if (next) {
          props.handleSelect(next);
        }
        return true;
      },
      hotkeyToken: TOKENS.channel.moveUp,
      displayPriority: 10,
    });

    registerHotkey({
      hotkey: 'arrowdown',
      scopeId: props.scopeId,
      description: 'Previous version',
      condition: () => props.isOpen,
      keyDownHandler: () => {
        const current = props.selectedVersion;
        const next = moveDown(props.versions, current);
        virtualHandle()?.scrollToIndex(
          findVersionIndex(props.versions, next ?? current),
          {
            align: 'nearest',
          }
        );
        if (next) {
          props.handleSelect(next);
        }
        return true;
      },
      hotkeyToken: TOKENS.channel.moveDown,
      displayPriority: 10,
    });
  });

  return (
    <VList data={props.versions} ref={setVirtualHandle}>
      {(item, index) => {
        const isSelected = () =>
          props.selectedVersion.peerId === item.representative.change.peer &&
          props.selectedVersion.counter === item.representative.change.counter;

        return (
          <VersionListItem
            item={item}
            isSelected={isSelected()}
            handleSelect={props.handleSelect}
            index={index()}
            total={props.versions.length}
          />
        );
      }}
    </VList>
  );
}

function IndexIndicator(props: {
  total: number;
  index: number;
  isSelected: boolean;
}) {
  const normalizeToLongest = (num: number) => {
    const longestLength = String(props.total).length;
    return num.toString().padStart(longestLength, '0');
  };

  return (
    <p
      class="font-mono"
      classList={{
        'text-accent': props.isSelected,
        'text-ink-extra-muted': !props.isSelected,
      }}
    >
      {normalizeToLongest(props.total - props.index)}
    </p>
  );
}

function VersionListItem(props: {
  item: GroupedHistory;
  isSelected: boolean;
  handleSelect?: (version: VersionId) => void;
  index: number;
  total: number;
}) {
  return (
    <button
      class="w-full p-2 sm:p-3 text-left flex items-center gap-2 sm:gap-3 min-h-[60px] sm:min-h-auto"
      classList={{
        'bg-hover': props.isSelected && !!props.handleSelect,
        'hover:bg-hover hover-transition-bg': !!props.handleSelect,
      }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        props.handleSelect?.({
          peerId: props.item.representative.change.peer,
          counter: props.item.representative.change.counter,
        });
      }}
    >
      <Show when={props.handleSelect}>
        <IndexIndicator
          total={props.total}
          index={props.index}
          isSelected={props.isSelected}
        />
      </Show>
      <UserIcon
        size="sm"
        isDeleted={false}
        id={props.item.representative.userId}
      />
      <div class="flex-1 min-w-0">
        <div class="text-ink text-xs truncate">
          {new Date(props.item.group.window.start * 1000).toLocaleString()} -{' '}
          {new Date(props.item.group.window.end * 1000).toLocaleTimeString()}
        </div>
        <div class="text-ink-extra-muted text-xs sm:text-xs">
          {props.item.group?.changes.length} changes
        </div>
      </div>
    </button>
  );
}
