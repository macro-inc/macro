import { useItemOperations } from '@core/component/FileList/useItemOperations';
import { TextButton } from '@core/component/TextButton';
import { useDeletedTree } from '@service-storage/deleted';

export function TrashBar() {
  const { bulkPermanentlyDelete } = useItemOperations();
  const trashTree = useDeletedTree();
  return (
    <div class="flex justify-between items-center rounded-lg mx-4 mt-4 px-5 py-2 bg-red-bg border-failure/50">
      <div class="text-sm">
        Items in trash will be deleted forever after 30 days
      </div>
      <TextButton
        theme="red"
        text="Empty trash"
        onClick={() => {
          bulkPermanentlyDelete(trashTree().rootItems.map((item) => item.item));
        }}
      />
    </div>
  );
}
