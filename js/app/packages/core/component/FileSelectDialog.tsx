import { isMobileWidth } from '@core/mobile/mobileWidth';
import { defaultFileSortPair, type SortPair } from '@core/util/sort';
import { Dialog } from '@kobalte/core/dialog';
import type { ItemType } from '@service-storage/client';
import type { Item } from '@service-storage/generated/schemas/item';
import { useHistoryTree } from '@service-storage/history';
import { createMemo, createSignal, type Setter } from 'solid-js';
import { createStore } from 'solid-js/store';
import { buildFileTreeWithAncestors } from './FileList/buildFileTree';
import { FileExplorer } from './FileList/FileExplorer';
import { ListViewHeader } from './FileList/ListViewHeader';
import { TextButton } from './TextButton';

type FileSelectDialogProps = {
  itemId: string;
  selectableTypes: ItemType[];
  onSelect: (folder?: Item) => void;
  open: boolean;
  setOpen: Setter<boolean>;
  title: string;
};

export function FileSelectDialog(props: FileSelectDialogProps) {
  const [selectedItems, setSelectedItems] = createSignal<Item[]>([]);
  const [fileSort, setFileSort] = createSignal<SortPair>(defaultFileSortPair);
  const expandedProjectsStore = createStore<{ [key: string]: boolean }>({});
  const fileTree = useHistoryTree();
  const [showProjectsFirst, setShowProjectsFirst] = createSignal(false);

  const allItems = Object.values(fileTree().itemMap).map((item) => item.item);
  const filteredItems = allItems.filter(
    (item) =>
      props.selectableTypes.includes(item.type) && item.id !== props.itemId
  );
  const filteredFileTree = createMemo(() =>
    buildFileTreeWithAncestors(filteredItems, allItems)
  );

  return (
    <Dialog open={props.open} onOpenChange={props.setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed flex inset-0 bg-modal-overlay items-center justify-center z-modal-overlay portal-scope" />
        <Dialog.Content class="fixed left-1/2 top-1/2 z-modal -translate-x-1/2 -translate-y-1/2 w-[616px] max-w-full h-[516px] max-h-full bg-dialog rounded-xl shadow-lg @container/split portal-scope flex flex-col">
          <Dialog.Title class="p-4 font-sans text-lg">
            {props.title}
          </Dialog.Title>
          <ListViewHeader
            fileSort={fileSort}
            setFileSort={setFileSort}
            showProjectsFirst={showProjectsFirst()}
            setShowProjectsFirst={setShowProjectsFirst}
            hideAction
          />
          <div class="flex-1 flex flex-col overflow-auto">
            <FileExplorer
              size={isMobileWidth() ? 'md' : 'sm'}
              viewType="treeList"
              currentFileTree={filteredFileTree}
              selectedItems={selectedItems}
              setSelectedItems={setSelectedItems}
              selectableTypes={props.selectableTypes}
              fileSort={fileSort}
              expandedProjectsStore={expandedProjectsStore}
              hasSearchOrFilter={false}
              showProjectsFirst={showProjectsFirst()}
              selectionOnly
            />
          </div>
          <div class="flex justify-end gap-3 p-4">
            <TextButton
              text="Cancel"
              theme="clear"
              onClick={() => props.setOpen(false)}
            />
            <TextButton
              text="Move"
              theme={selectedItems().length > 0 ? 'accent' : 'disabled'}
              onClick={() => {
                if (selectedItems().length > 0) {
                  props.onSelect(selectedItems().at(0));
                }
              }}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
