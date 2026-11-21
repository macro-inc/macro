/**
 * Repro (bun run repro/team-property.ts): a task's team select property,
 * unassigned, assigned, then with its assigned option deleted.
 * REST Soup (main's task-duplicate and hover readers) vs GraphQL Soup (the
 * branch's), on a fresh synthetic user and team.
 */
import { ApiUser } from '../lib/api';
const origin = process.argv[2] ?? 'https://localhost:23209';
const tag = Date.now().toString(36);
const owner = await new ApiUser(origin, `owner@wrepro-${tag}.difftest.dev`).login();
await owner.post('/auth/team', { name: `Difftest repro ${tag}`, allow_domain_join: false });
const { documentId: task } = await owner.post<{ documentId: string }>('/dss/documents/create_task', { taskName: `Repro task ${tag}`, shareWithTeam: true });
const created = await owner.post<any>('/dss/properties/definitions', {
  display_name: `Difftest stage ${tag}`, scope: 'team',
  data_type: { type: 'select_string', multi: false, options: ['Lead', 'Trial'].map((value, display_order) => ({ value, display_order })) },
});
const def = created.definition?.id ?? created.id;
const options = (await owner.get<{ id: string }[]>(`/dss/properties/definitions/${def}/options`)).map((o) => o.id);
const Q = `query { user { id soup(input: { initial: { limit: 50 } }) { items { __typename ... on GraphqlSoupDocument { id properties { propertyDefinitionId displayName value { __typename ... on GraphqlSelectOptionPropertyValue { optionIds } } } } } } } }`;
const read = async (label: string) => {
  // TaskDuplicateList.tsx:55 on main: QUERY_FILTERS_BASE plus the task ids.
  const X = { ids: ['00000000-0000-0000-0000-000000000000'] };
  const rest = await owner.post<any>('/dss/items/soup?limit=25', {
    agent_session_filters: { ids: X.ids }, calendar_event_filters: { calendar_event_ids: X.ids }, call_filters: { call_ids: X.ids },
    channel_filters: { channel_ids: X.ids }, channel_thread_filters: { thread_ids: X.ids }, chat_filters: { chat_ids: X.ids },
    crm_company_filters: { company_ids: X.ids }, email_filters: { email_thread_ids: X.ids }, foreign_entity_filters: { ids: X.ids },
    project_filters: { project_ids: X.ids }, document_filters: { document_ids: [task], sub_types: ['task'] },
  });
  const r = (rest.items ?? []).map((i: any) => i.data).find((i: any) => i?.id === task);
  const g = (await owner.graphql<any>(Q, {})).user.soup.items.find((i: any) => i.id === task);
  const pick = (ps: any[] | undefined, f: (p: any) => string) => (ps ?? []).filter((p) => f(p) === def);
  console.log(label);
  console.log('  REST    stage property:', JSON.stringify(pick(r?.properties, (p) => p.definition?.id)), 'of', r?.properties?.length);
  console.log('  GraphQL stage property:', JSON.stringify(pick(g?.properties, (p) => p.propertyDefinitionId)), 'of', g?.properties?.length);
};
await read('1. definition exists, no value');
await owner.raw(`/dss/properties/entities/DOCUMENT/${task}/${def}`, { method: 'PUT', body: JSON.stringify({ value: { type: 'select_option', option_id: options[0] } }) });
await read('2. option assigned');
await owner.del(`/dss/properties/definitions/${def}/options/${options[0]}`);
await read('3. the assigned option deleted');
