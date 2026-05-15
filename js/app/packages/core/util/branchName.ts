import { analytics } from '@app/lib/analytics';
import { toast } from '@core/component/Toast/Toast';

import { storageServiceClient } from '@service-storage/client';

export const copyBranchNameToClipboard = async (documentId: string) => {
  const result = await storageServiceClient.getDocumentBranchName({
    documentId,
  });
  if (!result.isOk()) {
    toast.failure('Failed to copy branch name');
    return;
  }
  try {
    await navigator.clipboard.writeText(result.value.branchName);
    analytics.track('task_copy_branch_name');
    toast.success('Branch name copied to clipboard');
  } catch {
    toast.failure('Could not copy branch name');
  }
};
