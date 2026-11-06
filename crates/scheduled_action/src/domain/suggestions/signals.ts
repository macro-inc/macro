export async function main({ macro }: StepContext) {
  const recent = await macro.workspace.page({
    includeTypes: ['calendar_event', 'document', 'channel', 'call'],
    limit: 60,
  });
  const calendar: string[] = [];
  const tasks: string[] = [];
  const documents: string[] = [];
  const channels: string[] = [];
  let calls = 0;
  for (const item of recent.items) {
    if (item.type === 'calendar_event' && item.title) calendar.push(item.title);
    if (item.type === 'document') (item.subType === 'task' ? tasks : documents).push(item.name);
    if (item.type === 'channel' && item.name) channels.push(item.name);
    if (item.type === 'call') calls += 1;
  }
  const pipelines: string[] = [];
  for (const pipeline of await macro.crm.pipelines.list()) pipelines.push(await pipeline.name);
  return { calendar, tasks, documents, channels, calls, pipelines };
}
