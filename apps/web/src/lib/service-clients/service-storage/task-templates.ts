import { dssFetch } from './client';
import type { CreateTaskTemplateRequest } from './generated/schemas/createTaskTemplateRequest';
import type { TaskTemplate } from './generated/schemas/taskTemplate';
import type { UpdateTaskTemplateRequest } from './generated/schemas/updateTaskTemplateRequest';

/** Personal templates plus templates from one currently joined team. */
export function listTaskTemplates(teamId?: string, signal?: AbortSignal) {
  const query = teamId ? `?${new URLSearchParams({ teamId })}` : '';
  return dssFetch<TaskTemplate[]>(`/task_templates${query}`, { signal });
}

/** Read one template using current account and team permissions. */
export function getTaskTemplate(id: string, signal?: AbortSignal) {
  return dssFetch<TaskTemplate>(`/task_templates/${encodeURIComponent(id)}`, {
    signal,
    trace: { expectedStatusCodes: [404] },
  });
}

/** Create one personal or team-owned template. */
export function createTaskTemplate(body: CreateTaskTemplateRequest) {
  return dssFetch<TaskTemplate>('/task_templates', {
    method: 'POST',
    body: JSON.stringify(body),
    trace: { expectedStatusCodes: [409] },
  });
}

/** Replace template content at the revision observed when editing began. */
export function updateTaskTemplate(
  id: string,
  body: UpdateTaskTemplateRequest
) {
  return dssFetch<TaskTemplate>(`/task_templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    trace: { expectedStatusCodes: [409] },
  });
}

/** Delete a template without changing tasks previously created from it. */
export function deleteTaskTemplate(id: string, revision: number) {
  const query = new URLSearchParams({ revision: String(revision) });
  return dssFetch(`/task_templates/${encodeURIComponent(id)}?${query}`, {
    method: 'DELETE',
    trace: { expectedStatusCodes: [409] },
  });
}
