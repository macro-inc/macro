import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import type { OpenEntityTarget } from './context/activity-context';

/** The app's `onOpen` for activity rows: open the entity in the split layout. */
export function openEntityInSplit({
  block,
  id,
  params,
  newSplit,
}: OpenEntityTarget): void {
  openDocument(block, id, params, newSplit);
}
