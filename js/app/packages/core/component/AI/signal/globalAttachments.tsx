import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant/fileType';
import type { Attachment } from '@core/component/AI/types';
import { getItemBlockName } from '@core/util/getItemBlockName';
import type { HistoryItem } from '@queries/history/history';
import { useHistoryQuery } from '@queries/history/history';
import {
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Suspense,
} from 'solid-js';
import { useTabAttachments } from './tabAttachments';

// ---- Global signals ----

const [globalTabAttachments, setGlobalTabAttachments] = createSignal<
  Attachment[]
>([]);

const [globalAttachableHistory, setGlobalAttachableHistory] = createSignal<
  HistoryItem[]
>([]);

const [globalAttachmentsReady, setGlobalAttachmentsReady] = createSignal(false);

export {
  globalTabAttachments,
  globalAttachableHistory,
  globalAttachmentsReady,
};

// ---- Init component (mount once at app root) ----

function GlobalAttachmentsInner() {
  const tabAttachments = useTabAttachments();
  const historyQuery = useHistoryQuery();

  const attachableHistory = createMemo(() => {
    return (historyQuery.data ?? []).filter((item) => {
      const blockName = getItemBlockName(item, true);
      return SUPPORTED_CHAT_ATTACHMENT_BLOCKS.includes(blockName);
    });
  });

  createEffect(() => {
    setGlobalTabAttachments(tabAttachments());
  });

  createEffect(() => {
    setGlobalAttachableHistory(attachableHistory());
  });

  onMount(() => {
    setGlobalAttachmentsReady(true);
  });

  return null;
}

export function TabAttachmentsInit() {
  return (
    <Suspense>
      <GlobalAttachmentsInner />
    </Suspense>
  );
}
