import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant/fileType';
import { getItemBlockName } from '@core/util/getItemBlockName';
import type { HistoryItem } from '@queries/history/history';
import { useHistoryQuery } from '@queries/history/history';
import { createEffect, createMemo, createSignal } from 'solid-js';

// ---- Global signals ----

const [globalAttachableHistory, setGlobalAttachableHistory] = createSignal<
  HistoryItem[]
>([]);

export { globalAttachableHistory };

/** Keeps `globalAttachableHistory` current; call once where the app's state lives. */
export function useGlobalAttachableHistory(): void {
  const historyQuery = useHistoryQuery();

  const attachableHistory = createMemo(() => {
    const history = historyQuery.isSuccess ? historyQuery.data : [];
    return history.filter((item) => {
      const blockName = getItemBlockName(item, true);
      return SUPPORTED_CHAT_ATTACHMENT_BLOCKS.includes(blockName);
    });
  });

  createEffect(() => {
    setGlobalAttachableHistory(attachableHistory());
  });
}
