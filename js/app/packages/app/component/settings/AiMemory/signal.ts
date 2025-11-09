import { isOk } from '@core/util/maybeResult';
import { useUserId } from '@service-gql/client';
import { insightClient } from '@service-insight/client';
import type { GetUserInsightsResponse } from '@service-insight/generated/schemas/getUserInsightsResponse';
import type { UserInsightRecord } from '@service-insight/generated/schemas/userInsightRecord';
import { createCallback } from '@solid-primitives/rootless';
import { createSignal } from 'solid-js';

// get current unix time in seconds
const nowSeconds = () => Date.now() / 1000;

export async function updateUserMemory(id: string, text: string) {
  let updated = false;
  const [_, setMemories] = memories;
  const now = nowSeconds();
  setMemories((p) => {
    if (!p) return p;
    const insights: UserInsightRecord[] = p.insights.map((mem) => {
      if (mem.id === id && mem.generated === false) {
        updated = true;
        return {
          ...mem,
          content: text,
          updatedAt: now,
        };
      } else {
        return mem;
      }
    });
    return {
      insights,
      total: p.total,
    };
  });
  // TODO error
  if (updated)
    await insightClient.updateUserInsight({ content: text, insight_id: id });
}

export async function deleteMemory(id: string) {
  const [_, setMemories] = memories;
  setMemories((p) => {
    if (!p) return p;
    const insights = p.insights.filter((i) => i.id !== id);
    return {
      insights,
      total: p.total - 1,
    };
  });

  // TODO toast on error
  await insightClient.deleteUserInsights({ ids: [id] });
}

export function useCreateUserMemory() {
  const userId = useUserId();
  const [, setMemories] = memories;

  return createCallback(async (text: string) => {
    const memory = await insightClient.createUserInsight({
      insights: [text],
    });
    // TODO ERROR
    if (isOk(memory)) {
      const [, { ids }] = memory;
      const id = ids[0];
      if (!id) return;
      const now = nowSeconds();

      const newMemory: UserInsightRecord = {
        content: text,
        createdAt: now,
        updatedAt: now,
        generated: false,
        source: 'user_created',
        userId: userId() ?? '',
      };
      setMemories((p) => {
        return {
          insights: [newMemory, ...(p ? p.insights : [])],
          total: p?.total ? p.total + 1 : 1,
        };
      });
    }
  });
}

export const memories = createSignal<GetUserInsightsResponse>();
export const insights = createSignal<GetUserInsightsResponse>();
export const creatingMemory = createSignal<boolean>(false);
export const loadError = createSignal<string>();
export const insightLoadError = createSignal<string>();
export const PAGE_SIZE = 5;
