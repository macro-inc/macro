import type { FileTree } from '@core/component/FileList/fileTree';
import type { SortDirection, SortPair } from '@core/util/sort';
import { type SortType, sortItems } from '@core/util/sort';
import type { ItemType } from '@service-storage/client';
import type { Item } from '@service-storage/generated/schemas/item';
import { usePinnedIds } from '@service-storage/pins';
import {
  type Accessor,
  createSelector,
  onCleanup,
  onMount,
  type ParentProps,
  type Setter,
} from 'solid-js';

type SelectionWrapperProps = {
  id: string;
  itemType: ItemType;
  selectableTypes?: ItemType[];
  selectedItems: Accessor<Item[]>;
  setSelectedItems: Setter<Item[]>;
  currentFileTree: FileTree;
  expandedProjects: { [key: string]: boolean };
  showProjectsFirst: boolean;
  fileSort: Accessor<SortPair>;
  // If true, only one item can be selected, and selection happens on unmodified click
  singleSelect?: boolean;
  deactivated?: boolean;
};

function findCommonParent(itemA: Item, itemB: Item, currentFileTree: FileTree) {
  const getParentId = (item: Item) => {
    return item.type === 'project' ? item.parentId : item.projectId;
  };

  const ancestorsA: string[] = [];
  let currentA = itemA;
  while (currentA) {
    // We need to check if currentA is a root item, because shared items have
    const isRootItem = currentFileTree.rootItems.some(
      (root) => root.item.id === currentA.id
    );
    if (isRootItem) break;

    const parentId = getParentId(currentA);
    if (!parentId) break;
    ancestorsA.push(parentId);
    currentA = currentFileTree.itemMap[parentId]?.item;
  }

  // Find the first common ancestor while traversing up from itemB
  let currentB = itemB;
  while (currentB) {
    // Check if currentB is a root item
    const isRootItem = currentFileTree.rootItems.some(
      (root) => root.item.id === currentB.id
    );
    if (isRootItem) {
      if (ancestorsA.includes(currentB.id)) {
        return currentB;
      }
      break;
    }

    const parentId = getParentId(currentB);
    if (!parentId) break;

    // If this parent is in ancestorsA, we found our common parent
    if (ancestorsA.includes(parentId)) {
      return currentFileTree.itemMap[parentId]?.item;
    }

    currentB = currentFileTree.itemMap[parentId]?.item;
  }

  // If we get here the the root is the common parent
  return null;
}

function generateFlatSortedList(
  commonParent: Item | null,
  currentFileTree: FileTree,
  sortType: SortType,
  sortDirection: SortDirection,
  expandedProjects: { [key: string]: boolean },
  showProjectsFirst: boolean
) {
  const flatSortedList: Item[] = [];
  const pinnedIds = usePinnedIds();
  const isPinned = createSelector(pinnedIds, (id: string, pinnedIds) =>
    pinnedIds.includes(id)
  );

  // Helper function to sort items at any level
  function sortItemsAtLevel(items: Item[]) {
    return items.sort((a, b) => {
      const aIsPinned = isPinned(a.id);
      const bIsPinned = isPinned(b.id);

      if (aIsPinned && !bIsPinned) return -1;
      if (!aIsPinned && bIsPinned) return 1;

      // If both items are pinned, sort by pin index
      if (aIsPinned && bIsPinned) {
        const aIndex = pinnedIds().indexOf(a.id);
        const bIndex = pinnedIds().indexOf(b.id);
        return aIndex - bIndex;
      }

      // If only one item is pinned, it goes first
      if (aIsPinned) return -1;
      if (bIsPinned) return 1;

      // Otherwise sort by sortType and sortDirection
      return sortItems(a, b, sortType, sortDirection, {
        showProjectsFirst: showProjectsFirst,
      });
    });
  }

  // Recursive function to process items and their children
  function processItems(items: Item[]) {
    const sortedItems = sortItemsAtLevel(items);

    for (const item of sortedItems) {
      flatSortedList.push(item);

      // If this is a project and it's expanded, process its children
      if (item.type === 'project' && expandedProjects[item.id]) {
        const children = currentFileTree.itemMap[item.id]?.children || [];
        processItems(children);
      }
    }
  }

  // Start with commonParent if it exists
  if (commonParent) {
    flatSortedList.push(commonParent);
  }

  // Get initial items to process (either children of commonParent or root items)
  const initialItems = commonParent
    ? currentFileTree.itemMap[commonParent.id]?.children || []
    : currentFileTree.rootItems.map((item) => item.item);

  // Process all items recursively
  processItems(initialItems);

  return flatSortedList;
}

export function SelectionWrapper(props: ParentProps<SelectionWrapperProps>) {
  const currentItem = props.currentFileTree.itemMap[props.id]?.item;
  const [sortType, sortDirection] = props.fileSort();

  const isSelectable = () => {
    if (!props.selectableTypes?.length) return true;
    return props.selectableTypes.includes(props.itemType);
  };
  const showProjectsFirst = props.showProjectsFirst;

  const isSelected = () => {
    return props.selectedItems().some((item) => item.id === props.id);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.setSelectedItems([]);
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  const handleSelection = (e: MouseEvent) => {
    if (!isSelectable()) return;

    if (props.singleSelect) {
      e.preventDefault();
      e.stopPropagation();
      if (!props.deactivated) {
        props.setSelectedItems([currentItem]);
      }
    } else if (e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      if (isSelected()) {
        // Toggle selection
        props.setSelectedItems((prev) =>
          prev.filter((item) => item.id !== props.id)
        );
      } else {
        if (currentItem) {
          props.setSelectedItems((prev) => [...prev, currentItem]);
        }
      }
    } else if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (isSelected()) {
        return props.setSelectedItems((prev) =>
          prev.filter((item) => item.id !== props.id)
        );
      }
      const n = props.selectedItems().length;
      if (n === 0) {
        return props.setSelectedItems([currentItem]);
      }
      const lastSelectedItem = props.selectedItems()[n - 1];
      const commonParent = findCommonParent(
        lastSelectedItem,
        currentItem,
        props.currentFileTree
      );
      const flatSortedList = generateFlatSortedList(
        commonParent,
        props.currentFileTree,
        sortType,
        sortDirection,
        props.expandedProjects,
        showProjectsFirst
      );
      const lastSelectedItemIndex = flatSortedList.findIndex(
        (item) => item.id === lastSelectedItem.id
      );
      const currentItemIndex = flatSortedList.findIndex(
        (item) => item.id === currentItem.id
      );
      const selectedItems =
        lastSelectedItemIndex <= currentItemIndex
          ? flatSortedList.slice(lastSelectedItemIndex, currentItemIndex + 1)
          : flatSortedList
              .slice(currentItemIndex, lastSelectedItemIndex + 1)
              .reverse();
      const uniqueSelectedItems = selectedItems.filter(
        (selectedItem) =>
          !props
            .selectedItems()
            .some((prevItem) => prevItem.id === selectedItem.id)
      );
      props.setSelectedItems((prev) => [...prev, ...uniqueSelectedItems]);
    } else {
      // Clear selection
      props.setSelectedItems([]);
    }
  };

  // SCUFFED STYLING: the layered backgrounds don't look great when you have items selected and either hovered or active.
  return (
    <div
      class={`${isSelected() ? 'bg-accent/20 transition-colors' : ''}`}
      onClick={handleSelection}
    >
      {props.children}
    </div>
  );
}
