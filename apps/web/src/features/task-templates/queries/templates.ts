import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import type { CreateTaskTemplateRequest } from '@service-storage/generated/schemas/createTaskTemplateRequest';
import type { UpdateTaskTemplateRequest } from '@service-storage/generated/schemas/updateTaskTemplateRequest';
import {
  createTaskTemplate,
  deleteTaskTemplate,
  listTaskTemplates,
  updateTaskTemplate,
} from '@service-storage/task-templates';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

function taskTemplatesOptions(
  viewerId: string | undefined,
  teamId: string | undefined,
  enabled: boolean
) {
  return queryOptions({
    queryKey: ['task-templates', viewerId, teamId ?? null],
    queryFn: ({ signal }) =>
      throwOnErr(() => listTaskTemplates(teamId, signal)),
    enabled: Boolean(viewerId) && enabled,
    staleTime: 0,
  });
}
export function useTaskTemplatesQuery(scope: {
  viewerId: Accessor<string | undefined>;
  teamId: Accessor<string | undefined>;
  enabled: Accessor<boolean>;
}) {
  return useQuery(() =>
    taskTemplatesOptions(scope.viewerId(), scope.teamId(), scope.enabled())
  );
}

export function useCreateTaskTemplate() {
  const client = useQueryClient();
  return useMutation(() => ({
    mutationFn: (input: {
      viewerId: string;
      body: CreateTaskTemplateRequest;
    }) =>
      Telemetry.span('task_template.create', async (span) => {
        const created = await throwOnErr(() => createTaskTemplate(input.body));
        span.setAttr('task_template.id', created.id);
        return created;
      }),
    onSuccess: (_created, input) => {
      fireAndForget(
        client.invalidateQueries({
          queryKey: ['task-templates', input.viewerId],
        }),
        'task-templates'
      );
    },
  }));
}

export function useUpdateTaskTemplate() {
  const client = useQueryClient();
  return useMutation(() => ({
    mutationFn: (input: {
      viewerId: string;
      id: string;
      body: UpdateTaskTemplateRequest;
    }) =>
      Telemetry.span('task_template.update', async (span) => {
        span.setAttr('task_template.id', input.id);
        return throwOnErr(() => updateTaskTemplate(input.id, input.body));
      }),
    onSuccess: (_updated, input) => {
      fireAndForget(
        client.invalidateQueries({
          queryKey: ['task-templates', input.viewerId],
        }),
        'task-templates'
      );
    },
  }));
}

export function useDeleteTaskTemplate() {
  const client = useQueryClient();
  return useMutation(() => ({
    mutationFn: (input: { viewerId: string; id: string; revision: number }) =>
      Telemetry.span('task_template.delete', async (span) => {
        span.setAttr('task_template.id', input.id);
        return throwOnErr(() => deleteTaskTemplate(input.id, input.revision));
      }),
    onSuccess: (_deleted, input) => {
      fireAndForget(
        client.invalidateQueries({
          queryKey: ['task-templates', input.viewerId],
        }),
        'task-templates'
      );
    },
  }));
}
