import { storageServiceClient } from '@service-storage/client';
import type { SystemSkillSummary } from '@service-storage/generated/schemas/systemSkillSummary';
import { useQuery } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';

const SYSTEM_SKILLS_QUERY_KEY = ['storage', 'system-skills'] as const;

/**
 * Built-in system skills served by the storage service. System skills are
 * static, code-defined AI instructions (crates/system_skills) with well-known
 * ids: they surface in the skills menu and skill mentions like user skills,
 * but have no document behind them and must never be opened as documents.
 *
 * The list is fixed per deploy, so it is fetched once and cached forever.
 */
export function useSystemSkillsQuery() {
  const query = useQuery(() => ({
    queryKey: SYSTEM_SKILLS_QUERY_KEY,
    queryFn: async () => {
      const result = await storageServiceClient.getSystemSkills();
      if (result.isErr()) {
        throw new Error('Failed to fetch system skills');
      }
      return result.value.skills;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  }));

  const skills = createMemo<SystemSkillSummary[]>(() =>
    query.isSuccess ? (query.data ?? []) : []
  );
  const byId = createMemo(
    () => new Map(skills().map((skill) => [skill.id, skill]))
  );

  return {
    query,
    skills,
    /** Look up a system skill; undefined while loading or for other ids. */
    getSystemSkill: (id: string) => byId().get(id),
    /** Whether `id` belongs to a (loaded) system skill. */
    isSystemSkillId: (id: string) => byId().has(id),
  };
}
