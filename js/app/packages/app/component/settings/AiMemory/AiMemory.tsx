import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { TabContent } from '@core/component/TabContent';
import { isErr } from '@core/util/maybeResult';
import { insightClient } from '@service-insight/client';
import { Match, onMount, Switch } from 'solid-js';
import { MemoryList } from './component/MemoryList';
import {
  insightLoadError,
  insights as insightsSignal,
  loadError,
  memories as memoriesSignal,
  PAGE_SIZE,
} from './signal';

async function fetchMemories() {
  const [, setLoadError] = loadError;
  const [, setMemories] = memoriesSignal;
  const [, setInsightLoadError] = insightLoadError;
  const [, setInsights] = insightsSignal;

  const insights = await insightClient.getUserInsight({
    limit: PAGE_SIZE * 5,
    generated: true,
    offset: 0,
  });

  if (isErr(insights)) {
    const [err] = insights;
    setInsightLoadError(err[0].code);
  } else {
    const [, insightData] = insights;
    setInsights(insightData);
  }

  const memories = await insightClient.getUserInsight({
    limit: PAGE_SIZE * 5,
    generated: false,
    offset: 0,
  });

  if (isErr(memories)) {
    const [err] = memories;
    setLoadError(err[0].code);
  } else {
    const [, insightData] = memories;
    setMemories(insightData);
  }
}

export function AiMemory() {
  const [memories] = memoriesSignal;
  const [insights] = insightsSignal;
  const [error] = loadError;

  onMount(() => fetchMemories());

  return (
    <div class="w-full h-full flex flex-col">
      <TabContent title="AI Memory">
        <div class="text-sm pb-8">
          Macro AI remembers your preferences and who you are
        </div>
      </TabContent>
      <Switch>
        <Match when={insights()}>
          {(memories) => (
            <MemoryList
              memories={memories().insights}
              total={memories().total}
              editable={false}
            />
          )}
        </Match>
        <Match when={!memories && !error()}>
          <div class="w-full h-full flex items-center justify-center font-medium">
            <LoadingSpinner />
          </div>
        </Match>
        <Match when={error()}>
          <div class="h-full w-full font-medium flex items-center justify-center">
            Error loading memory
          </div>
        </Match>
      </Switch>
    </div>
  );
}
