import { blockViewType } from '@block-project/signal/view';
import { IconButton } from '@core/component/IconButton';
import GridIcon from '@icon/regular/squares-four.svg?component-solid';
import TreeViewIcon from '@icon/regular/tree-view.svg?component-solid';

export function ViewSelector() {
  const viewType = blockViewType.get;
  const setViewType = blockViewType.set;

  return (
    <div class="flex gap-1">
      <IconButton
        icon={TreeViewIcon}
        onClick={() => setViewType('treeList')}
        theme={viewType() === 'treeList' ? 'accent' : 'base'}
        tooltip={{ label: 'List view' }}
      />
      <IconButton
        icon={GridIcon}
        onClick={() => setViewType('grid')}
        theme={viewType() === 'grid' ? 'accent' : 'base'}
        tooltip={{ label: 'Grid view' }}
      />
    </div>
  );
}
