import { createBlockStore } from '@core/block';
import type { FileTree } from '@core/component/FileList/fileTree';
export const blockFilteredFileTreeStore = createBlockStore<FileTree>({
  rootItems: [],
  itemMap: {},
});
