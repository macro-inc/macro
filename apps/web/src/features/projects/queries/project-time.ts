import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { useProjectsContext } from '../context/projects-context';

export type TimeEntry = {
  userId: string;
  userName: string;
  taskId: string;
  taskName: string;
  minutes: number;
};

export type ProjectTimeData = {
  entries: TimeEntry[];
  totalMinutes: number;
  byPerson: {
    userId: string;
    userName: string;
    totalMinutes: number;
    tasks: { taskId: string; taskName: string; minutes: number }[];
  }[];
};

export function useProjectTimeQuery(projectId: Accessor<string>) {
  const context = useProjectsContext();

  return useQuery(() => ({
    queryKey: ['project-time', projectId()],
    queryFn: async (): Promise<ProjectTimeData> => {
      const source = context.createProjectSource(projectId);
      const project = source.project();
      if (!project) {
        return { entries: [], totalMinutes: 0, byPerson: [] };
      }

      // TODO: Implement actual time aggregation from task properties.
      // This requires either extending ProjectsContext with task property
      // access or using a separate query to fetch task properties.
      // For now, return empty data - the UI will show an empty state.
      return { entries: [], totalMinutes: 0, byPerson: [] };
    },
    staleTime: 30_000,
  }));
}
