import { toast } from '@core/component/Toast/Toast';
import {
  useCreateInstructionsMd,
  useInstructionsMdIdQuery,
} from '@service-storage/instructionsMd';
import { useSplitLayout } from 'app/component/split-layout/layout';

const showFailToast = () => {
  toast.failure('Failed to open AI instructions document');
};

export function useOpenInstructionsMd() {
  const maybeId = useInstructionsMdIdQuery();
  const createInstructionsMd = useCreateInstructionsMd();
  const { insertSplit } = useSplitLayout();

  // returns true if the document was opened (or already open)
  const open = (id: string | null | undefined): boolean => {
    if (id) {
      insertSplit({
        id,
        type: 'md',
      });
      return true;
    }
    return false;
  };

  return () => {
    const id = maybeId.data;
    const success = open(id);
    if (success) return;

    // needs to be created
    if (id === null) {
      createInstructionsMd().then((id) => {
        const success = open(id);
        if (success) return;
        showFailToast();
      });
      return;
    }

    showFailToast();
  };
}
