import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { toast } from '@core/component/Toast/Toast';
import type { OpenEntityTarget } from './context/activity-context';

/** The app's `onOpen` for activity rows: open the entity in the split layout. */
export function openEntityInSplit({
  block,
  id,
  params,
  newSplit,
}: OpenEntityTarget): void {
  const result = openDocument(block, id, params, newSplit);
  if (result?.status === 'reused' && result.owner !== result.sourceOwner) {
    toast.alert('Content already open');
  }
}
