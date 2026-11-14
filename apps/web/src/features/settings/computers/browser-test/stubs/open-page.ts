import { setAgentsPageOpened } from './fixture-state';

export function openAgentsPage(
  _layout: unknown,
  page: string,
  params: Record<string, unknown> = {}
) {
  setAgentsPageOpened({ page, params });
}
