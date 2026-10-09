import { mkdir, writeFile } from 'node:fs/promises';

const apiKey = process.env.DD_API_KEY;
const appKey = process.env.DD_APP_KEY;
if (!apiKey || !appKey)
  throw new Error('Datadog read credentials are required');
const headers = { 'DD-API-KEY': apiKey, 'DD-APPLICATION-KEY': appKey };
async function read(path: string): Promise<unknown> {
  const response = await fetch(`https://api.us5.datadoghq.com/api/v1/${path}`, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Datadog ${path}: HTTP ${response.status}`);
  return response.json();
}

const destination = process.argv[2];
if (!destination) throw new Error('Provide an output directory');
await mkdir(destination, { recursive: true });
const monitors: unknown[] = [];
for (let page = 0; ; page++) {
  const batch = await read(`monitor?page=${page}&page_size=100`);
  if (!Array.isArray(batch)) throw new Error('Invalid monitor response');
  monitors.push(...batch);
  if (batch.length < 100) break;
}
await writeFile(
  `${destination}/monitors.json`,
  JSON.stringify(monitors, null, 2)
);
const dashboards: { id: string }[] = [];
for (let start = 0; ; start += 100) {
  const response = await read(`dashboard?count=100&start=${start}`);
  if (
    !response ||
    typeof response !== 'object' ||
    !('dashboards' in response) ||
    !Array.isArray(response.dashboards)
  )
    throw new Error('Invalid dashboard response');
  const entries: unknown[] = response.dashboards;
  for (const dashboard of entries) {
    if (
      !dashboard ||
      typeof dashboard !== 'object' ||
      !('id' in dashboard) ||
      typeof dashboard.id !== 'string' ||
      !/^[a-zA-Z0-9-]+$/.test(dashboard.id)
    )
      throw new Error('Invalid dashboard ID');
    dashboards.push({ id: dashboard.id });
    const definition = await read(`dashboard/${dashboard.id}`);
    await writeFile(
      `${destination}/dashboard-${dashboard.id}.json`,
      JSON.stringify(definition, null, 2)
    );
  }
  if (response.dashboards.length < 100) break;
}
await writeFile(
  `${destination}/dashboards.json`,
  JSON.stringify(dashboards, null, 2)
);
console.log(
  `Exported ${monitors.length} monitors and ${dashboards.length} dashboards`
);
