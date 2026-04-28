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

const buildBranchName = (shortId: string, documentName: string): string => {
  const suffix = `macro-${shortId}`;
  const slug = slugify(documentName);
  const maxSlugLength = MAX_BRANCH_LENGTH - suffix.length - 1;
  let truncatedSlug = slug.slice(0, maxSlugLength);
  if (truncatedSlug.length < slug.length) {
    const lastBoundary = truncatedSlug.lastIndexOf('-');
    if (lastBoundary > 0) {
      truncatedSlug = truncatedSlug.slice(0, lastBoundary);
    }
  }
  truncatedSlug = truncatedSlug.replace(/-+$/, '');
  return truncatedSlug ? `${truncatedSlug}-${suffix}` : suffix;
};

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
  const branchName = buildBranchName(shortId, documentName);
  try {
    await navigator.clipboard.writeText(branchName);
    analytics.track('task_copy_branch_name');
    toast.success('Branch name copied to clipboard');
  } catch {
    toast.failure('Could not copy branch name');
  }
};
