import type { MentionItem } from '../../utils/mentionsUtils';

/** Model operations used by the existing mention providers and controller. */
export interface MentionMenuHost {
  root(): HTMLElement | null;
  closeSearch(): void;
  select(item: MentionItem): Promise<void> | undefined;
}
