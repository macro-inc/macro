import { isErr } from '@core/util/maybeResult';
import { insightClient } from '@service-insight/client';
import { QueryClient, useQuery } from '@tanstack/solid-query';

const queryClient = new QueryClient();

export function useFormatMemoriesQuery() {
  const query = useQuery(
    () => ({
      queryKey: ['formatMemoriesId'],
      queryFn: formatMemories,
      staleTime: Infinity,
      throwOnError: false,
      retry: false,
      retryOnMount: false,
    }),
    () => queryClient
  );

  return query;
}

async function formatMemories(): Promise<string> {
  const generatedInsightsRes = await insightClient.getUserInsight({
    generated: true,
  });
  if (isErr(generatedInsightsRes)) {
    throw new Error('getting memory');
  }
  let [, generatedInsights] = generatedInsightsRes;

  const smartInsights = generatedInsights.insights
    .map((mem) => mem.content)
    .join(`\n`);

  return `\nThese are user preferences generated from usage. Adapt your responses to fit the user:\n${smartInsights}`;
}
