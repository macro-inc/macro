import { analytics } from '@app/lib/analytics';
import { toast } from '@core/component/Toast/Toast';
import { isOk } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';

const MAX_BRANCH_LENGTH = 200;

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export const copyBranchNameToClipboard = async (
  documentId: string,
  documentName: string
) => {
  const result = await storageServiceClient.getDocumentShortId({ documentId });
  if (!isOk(result)) {
    toast.failure('Failed to copy branch name');
    return;
  }
  const shortId = result[1];
  const slug = slugify(documentName);
  const branchName = `macro-${shortId}${slug ? `-${slug}` : ''}`.slice(
    0,
    MAX_BRANCH_LENGTH
  );
  await navigator.clipboard.writeText(branchName);
  analytics.track('task_copy_branch_name');
  toast.success('Branch name copied to clipboard');
};
