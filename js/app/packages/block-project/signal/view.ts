import { createBlockSignal } from '@core/block';
import type { FileListSize } from '@core/component/FileList/constants';
import type { ViewType } from '@core/component/FileList/viewTypes';

export const blockViewType = createBlockSignal<ViewType>('treeList');
export const blockViewSize = createBlockSignal<FileListSize>('md');
