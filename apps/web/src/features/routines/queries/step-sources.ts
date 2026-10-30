import { throwOnErr } from '@core/util/result';
import { emailKeys } from '@queries/email/keys';
import { useTagsQuery } from '@queries/properties/tags';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';

/** Custom Gmail label names across the user's inboxes, for label steps. */
export function useEmailLabelNames() {
  const query = useQuery(() => ({
    queryKey: emailKeys.labels.queryKey,
    queryFn: async () =>
      await throwOnErr(async () => await emailClient.getUserLabels()),
    staleTime: 5 * 60 * 1000,
  }));
  return () => {
    const labels = query.isSuccess ? query.data.labels : [];
    return [
      ...new Set(
        labels
          .filter((label) => label.type === 'User')
          .map((label) => label.name.trim())
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));
  };
}

export type RoutineTagOption = {
  definitionId: string;
  optionId: string;
  label: string;
  color?: string;
  scope: string;
};

/** Every tag the user can apply, personal and team. */
export function useRoutineTags() {
  const query = useTagsQuery();
  return (): RoutineTagOption[] =>
    (query.isSuccess ? query.data : []).flatMap((set) =>
      set.options.map((option) => ({
        definitionId: option.propertyDefinitionId,
        optionId: option.id,
        label: option.value.type === 'string' ? option.value.value : '',
        color: option.color ?? undefined,
        scope: set.scope,
      }))
    );
}
