/** Local, real-stack benchmark. Creates disposable copies; never edits the source.
 * See docs/architecture/canvas.md. Credentials stay in the supplied storage file
 * and process memory; output contains only IDs, timings, counts and invariants.
 */
import { isDeepStrictEqual } from 'node:util';
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const required = (name) => {
  const value = process.env[name];
  if (!value)
    throw new Error(`Set ${name}; see Canvas benchmark instructions.`);
  return value;
};
const app = required('CANVAS_BENCH_APP_URL').replace(/\/$/, '');
const sourceId = required('CANVAS_BENCH_SOURCE_ID');
const worker = required('CANVAS_BENCH_WORKER_URL').replace(/\/$/, '');
const output = required('CANVAS_BENCH_OUTPUT');
const mode = process.env.CANVAS_BENCH_MODE ?? 'main';
if (!['main', 'execution'].includes(mode))
  throw new Error('Mode must be main or execution.');
const browser = await chromium.connectOverCDP(required('CANVAS_BENCH_CDP_URL'));
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  storageState: required('CANVAS_BENCH_STORAGE_STATE'),
  viewport: { width: 1600, height: 1000 },
});
context.setDefaultTimeout(30_000);
const page = await context.newPage();
await page.goto(`${app}/app/drive`, { waitUntil: 'domcontentloaded' });
const proof =
  process.env.CANVAS_BENCH_RESUME === '1' ||
  process.env.CANVAS_BENCH_VERIFY === '1'
    ? JSON.parse(await readFile(output, 'utf8'))
    : { mode, sourceId, started: new Date().toISOString(), results: [] };
if (proof.mode !== mode || proof.sourceId !== sourceId)
  throw new Error('Resume output has a different benchmark scope.');

async function callWorker(documentId, documentToken, request) {
  const response = await fetch(`${worker}/canvas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ documentId, documentToken, request }),
    signal: AbortSignal.timeout(130_000),
  });
  const result = await response.json();
  if (!response.ok || result.error)
    throw new Error(result.error ?? `Canvas HTTP ${response.status}`);
  return result;
}
async function agent(method, args) {
  return page.evaluate(
    async ({ method, args }) => {
      const { agentHarnessServiceClient: client } = await import(
        '/src/lib/service-clients/service-agent-harness/client.ts'
      );
      const result = await client[method](...args);
      if (result.isErr())
        throw new Error(`Agent ${method} failed: ${result.error[0]?.code}`);
      return result.value;
    },
    { method, args }
  );
}
function envelope(entry) {
  return typeof entry.content === 'string'
    ? JSON.parse(entry.content)
    : entry.content;
}
function summarize(entries) {
  const tools = new Map();
  let start, end;
  for (const entry of entries) {
    const frame = envelope(entry);
    if (frame?.method === 'session/prompt') start = entry.createdAt;
    if (frame?.result?.stopReason) end = entry.createdAt;
    const update = frame?.params?.update;
    if (update?.sessionUpdate === 'tool_call')
      tools.set(update.toolCallId, {
        name: update.title,
        started: entry.createdAt,
      });
    if (
      update?.sessionUpdate === 'tool_call_update' &&
      tools.has(update.toolCallId) &&
      ['completed', 'failed'].includes(update.status)
    ) {
      const tool = tools.get(update.toolCallId);
      tool.finished = entry.createdAt;
      tool.status = update.status;
      // Log timestamps can be batched. Actual tool durations come from Tempo.
    }
  }
  return {
    started: start,
    finished: end,
    totalMs: end && start ? Date.parse(end) - Date.parse(start) : undefined,
    tools: [...tools.values()],
  };
}
async function resetIdleRendererPages() {
  const endpoint = process.env.CANVAS_BENCH_RENDER_CDP_URL;
  if (!endpoint) return;
  const discovery = await (
    await fetch(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(10_000),
    })
  ).json();
  const url = new URL(discovery.webSocketDebuggerUrl);
  url.host = new URL(endpoint).host;
  const socket = new WebSocket(url);
  const pending = new Map();
  let next = 0;
  socket.addEventListener('message', (event) => {
    const value = JSON.parse(event.data);
    const wait = pending.get(value.id);
    if (!wait) return;
    pending.delete(value.id);
    if (value.error) wait.reject(new Error('Benchmark CDP command failed.'));
    else wait.resolve(value.result);
  });
  const send = (method, params = {}, sessionId) => {
    const id = ++next;
    const result = Promise.withResolvers();
    pending.set(id, result);
    socket.send(JSON.stringify({ id, method, params, sessionId }));
    return result.promise;
  };
  const expired = setTimeout(() => {
    for (const wait of pending.values())
      wait.reject(new Error('Benchmark CDP timeout'));
    socket.close();
  }, 15_000);
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const { targetInfos } = await send('Target.getTargets');
    for (const target of targetInfos) {
      if (
        target.type !== 'page' ||
        target.url !== `${app}/canvas-render.html` ||
        !target.browserContextId
      )
        continue;
      const { sessionId } = await send('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: true,
      });
      const value = await send(
        'Runtime.evaluate',
        { expression: 'window.canvasRenderIdle === true', returnByValue: true },
        sessionId
      );
      await send('Target.detachFromTarget', { sessionId });
      // Explicitly idle, anonymous renderer contexts only; no app/user tabs.
      if (value.result.value === true)
        await send('Target.disposeBrowserContext', {
          browserContextId: target.browserContextId,
        });
    }
  } finally {
    clearTimeout(expired);
    socket.close();
  }
}
async function observe() {
  await page.evaluate(() => {
    const visible = (element) => {
      const bounds = element.getBoundingClientRect();
      const viewport = document
        .querySelector('[aria-label="Graphics canvas"]')
        ?.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        viewport &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0' &&
        bounds.right > Math.max(viewport.left, 0) &&
        bounds.left < Math.min(viewport.right, innerWidth) &&
        bounds.bottom > Math.max(viewport.top, 0) &&
        bounds.top < Math.min(viewport.bottom, innerHeight)
      );
    };
    const signature = () =>
      [...document.querySelectorAll('[data-graphics-item]')]
        .filter(visible)
        .map((element) => element.outerHTML)
        .join('|');
    const initial = signature();
    window.canvasBenchmarkObserver?.disconnect();
    window.canvasBenchmark = {
      started: performance.now(),
      firstPresenceMs: null,
      firstChangeMs: null,
      maxCursors: 0,
      changeMetric:
        'visible canonical DOM mutation; excludes ephemeral ghosts, not a compositor paint timestamp',
    };
    window.canvasBenchmarkObserver = new MutationObserver(() => {
      const state = window.canvasBenchmark;
      const count = [
        ...document.querySelectorAll('[data-presence-cursor]'),
      ].filter((element) => [...element.children].some(visible)).length;
      state.maxCursors = Math.max(state.maxCursors, count);
      if (count && state.firstPresenceMs === null)
        state.firstPresenceMs = performance.now() - state.started;
      if (state.firstChangeMs === null && signature() !== initial)
        state.firstChangeMs = performance.now() - state.started;
    });
    window.canvasBenchmarkObserver.observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
  });
}

const cases = [
  {
    name: 'move',
    prompt:
      'Move the three FIXED PIVOT boxes down 20 units. Preserve all other content, sizes, labels and styles.',
    code: (scene) =>
      `editor.move(${JSON.stringify(scene.items.filter((item) => item.text?.startsWith('FIXED PIVOT')).map((item) => item.id))},0,20)`,
  },
  {
    name: 'relabel-style',
    prompt:
      'Change the QUICKSORT title to "QUICKSORT EXPLAINED", use readable 30px sans text, and make its text color #155e75. Preserve every other item.',
    code: (scene) => {
      const id = scene.items.find((item) => item.text === 'QUICKSORT').id;
      return `editor.text(${JSON.stringify(id)},"QUICKSORT EXPLAINED");editor.textStyle(${JSON.stringify(id)},{fontSize:30,fontFamily:"sans"});editor.style([${JSON.stringify(id)}],{fill:"#155e75"})`;
    },
  },
  {
    name: 'callouts',
    prompt:
      'Add exactly two readable 22px rectangular callouts at x2600,y200 and x2600,y500, width320 and grow height: "Pivot stays fixed after partitioning." and "Each remaining side recurses independently." Preserve all existing items.',
    code: () =>
      'editor.create({type:"rectangle",x:2600,y:200,width:320,fontSize:22,text:"Pivot stays fixed after partitioning."});editor.create({type:"rectangle",x:2600,y:500,width:320,fontSize:22,text:"Each remaining side recurses independently."})',
  },
  {
    name: 'diagram',
    prompt:
      'Design a compact readable three-step flow in the unused space x2600–3100: "Choose pivot", "Partition", "Recurse", with two bound arrows. Use readable 22px text and comfortable spacing, preserve every existing item, and visually review the new flow.',
    code: () =>
      'const ids=["Choose pivot","Partition","Recurse"].map((text,i)=>editor.create({type:"rectangle",x:2600,y:200+i*200,width:320,fontSize:22,text}));for(let i=0;i<2;i++)editor.connect({start:{point:{x:2760,y:280+i*200},binding:{targetId:ids[i],anchor:"bottom"}},end:{point:{x:2760,y:400+i*200},binding:{targetId:ids[i+1],anchor:"top"}}})',
  },
];

function verifyRequested(task, before, after) {
  const same = isDeepStrictEqual;
  const originalIds = new Set(before.items.map((item) => item.id));
  const added = after.items.filter((item) => !originalIds.has(item.id));
  let valid = false;
  if (task.name === 'move') {
    const targets = before.items.filter((item) =>
      item.text?.startsWith('FIXED PIVOT')
    );
    valid =
      targets.length === 3 &&
      !added.length &&
      targets.every((item) => {
        const next = after.items.find((value) => value.id === item.id);
        return (
          next &&
          next.bounds.x === item.bounds.x &&
          next.bounds.y === item.bounds.y + 20 &&
          same(next.geometry, item.geometry) &&
          same(next.appearance, item.appearance) &&
          next.text === item.text
        );
      });
  } else if (task.name === 'relabel-style') {
    const original = before.items.find((item) => item.text === 'QUICKSORT');
    const title = after.items.find((item) => item.id === original?.id);
    valid =
      !added.length &&
      title?.text === 'QUICKSORT EXPLAINED' &&
      title.geometry.fontSize === 30 &&
      title.geometry.fontFamily === 'sans' &&
      title.appearance.fill.toLowerCase() === '#155e75';
  } else if (task.name === 'callouts') {
    valid =
      added.length === 2 &&
      [
        'Pivot stays fixed after partitioning.',
        'Each remaining side recurses independently.',
      ].every((text, index) => {
        const shape = added.find((item) => item.text === text);
        return (
          shape?.type === 'rectangle' &&
          shape.bounds.x === 2600 &&
          shape.bounds.y === 200 + index * 300 &&
          shape.bounds.width === 320 &&
          shape.geometry.label.fontSize === 22
        );
      });
  } else {
    const nodes = ['Choose pivot', 'Partition', 'Recurse'].map((text) =>
      added.find((item) => item.text === text)
    );
    const arrows = added.filter((item) => item.type === 'connector');
    valid =
      nodes.every(
        (item) =>
          item?.type === 'rectangle' &&
          item.bounds.x >= 2600 &&
          item.bounds.x + item.bounds.width <= 3100 &&
          item.geometry.label.fontSize === 22
      ) &&
      nodes[0].bounds.y + nodes[0].bounds.height < nodes[1].bounds.y &&
      nodes[1].bounds.y + nodes[1].bounds.height < nodes[2].bounds.y &&
      arrows.length === 2 &&
      [0, 1].every((index) =>
        arrows.some(
          (arrow) =>
            arrow.geometry.start.binding?.targetId === nodes[index].id &&
            arrow.geometry.end.binding?.targetId === nodes[index + 1].id &&
            arrow.geometry.endHead === 'arrow'
        )
      );
  }
  if (!valid)
    throw new Error(
      `Requested ${task.name} outcome failed on disposable document; no replay attempted.`
    );
  return true;
}

async function readAuthorized(documentId) {
  const token = await page.evaluate(async (id) => {
    const { getDocumentPermissionToken } = await import(
      '/src/lib/service-clients/service-storage/client.ts'
    );
    return getDocumentPermissionToken(id);
  }, documentId);
  return JSON.parse(
    (await callWorker(documentId, token, { action: 'read' })).canvas
  );
}

try {
  if (process.env.CANVAS_BENCH_VERIFY === '1') {
    const source = await readAuthorized(sourceId);
    for (const row of proof.results) {
      row.requestedOutcome = verifyRequested(
        cases.find((task) => task.name === row.case),
        source,
        await readAuthorized(row.documentId)
      );
      console.log(
        JSON.stringify({
          case: row.case,
          temperature: row.temperature,
          requestedOutcome: row.requestedOutcome,
        })
      );
    }
    await writeFile(output, JSON.stringify(proof, null, 2), { mode: 0o600 });
  } else
    for (const task of cases)
      for (const temperature of ['cold', 'warm']) {
        if (
          proof.results.some(
            (result) =>
              result.case === task.name && result.temperature === temperature
          )
        )
          continue;
        if (temperature === 'cold') await resetIdleRendererPages();
        const clone = await page.evaluate(
          async ({ sourceId, name }) => {
            const { storageServiceClient: client, getDocumentPermissionToken } =
              await import(
                '/src/lib/service-clients/service-storage/client.ts'
              );
            const result = await client.copyDocument({
              documentId: sourceId,
              documentName: name,
            });
            if (result.isErr())
              throw new Error(
                'Benchmark copy failed; no source edits attempted.'
              );
            return {
              documentId: result.value.documentId,
              name: result.value.documentName,
              token: await getDocumentPermissionToken(result.value.documentId),
            };
          },
          {
            sourceId,
            name: `QA Canvas benchmark ${mode} ${task.name} ${temperature} ${Date.now()}`,
          }
        );
        const before = JSON.parse(
          (await callWorker(clone.documentId, clone.token, { action: 'read' }))
            .canvas
        );
        await page.evaluate((id) => {
          const link = document.createElement('a');
          link.href = `/app/drive/canvas/${id}`;
          document.body.append(link);
          link.click();
          link.remove();
        }, clone.documentId);
        await page.waitForURL(`${app}/app/drive/canvas/${clone.documentId}`);
        await page.getByText(clone.name, { exact: true }).last().waitFor();
        await page.locator('[data-graphics-item]').first().waitFor();
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        for (let zoom = 0; zoom < 2; zoom++) {
          await page
            .getByRole('button', { name: 'Zoom options', exact: true })
            .click();
          await page.getByRole('menuitem', { name: /^Zoom Out/ }).click();
        }
        const result = {
          case: task.name,
          temperature,
          documentId: clone.documentId,
          beforeItems: before.totalItems,
        };
        if (mode === 'main') {
          const created = await agent('create', [
            {
              botId: '00000000-0000-0000-0000-00000000a2a2',
              model: 'anthropic/claude-sonnet-5-5',
            },
          ]);
          result.sessionId = created.session.id;
          result.model = created.session.model;
          await observe();
          await agent('control', [
            result.sessionId,
            {
              type: 'prompt',
              prompt: `On Canvas document ${clone.documentId}, ${task.prompt}`,
            },
          ]);
          const deadline = Date.now() + 180_000;
          for (;;) {
            const log = await agent('getLog', [result.sessionId]);
            const summary = summarize(log.entries);
            if (summary.finished) {
              Object.assign(result, summary);
              break;
            }
            if (Date.now() > deadline)
              throw new Error(
                `Main-agent benchmark timed out: ${result.sessionId}; inspect before retrying.`
              );
            await delay(1000);
          }
        } else {
          await observe();
          const start = performance.now();
          const response = await callWorker(clone.documentId, clone.token, {
            action: 'apply',
            expectedRevision: before.revision,
            code: task.code(before),
            editorName: 'Macro benchmark',
          });
          result.totalMs = performance.now() - start;
          result.operationsApplied = response.operationsApplied;
          result.modelCalls = 0;
        }
        result.browser = await page.evaluate(() => ({
          ...window.canvasBenchmark,
          started: undefined,
        }));
        const after = JSON.parse(
          (await callWorker(clone.documentId, clone.token, { action: 'read' }))
            .canvas
        );
        result.afterItems = after.totalItems;
        result.requestedOutcome = verifyRequested(task, before, after);
        const changed = new Set(
          before.items
            .filter((item) =>
              task.name === 'move'
                ? item.text?.startsWith('FIXED PIVOT')
                : task.name === 'relabel-style' && item.text === 'QUICKSORT'
            )
            .map((item) => item.id)
        );
        for (const item of before.items)
          if (
            item.type === 'connector' &&
            [
              item.geometry?.start?.binding?.targetId,
              item.geometry?.end?.binding?.targetId,
            ].some((id) => changed.has(id))
          )
            changed.add(item.id);
        result.unrelatedPreserved = before.items
          .filter((item) => !changed.has(item.id))
          .every(
            (item) =>
              JSON.stringify(item) ===
              JSON.stringify(after.items.find((value) => value.id === item.id))
          );
        const image = (
          await callWorker(clone.documentId, clone.token, {
            action: 'render',
            crop:
              task.name === 'move' || task.name === 'relabel-style'
                ? { x: 0, y: 0, width: 2500, height: 1600 }
                : { x: 2500, y: 100, width: 800, height: 1000 },
          })
        ).render;
        result.textOverflow = image.textLayout.filter(
          (item) => item.overflow
        ).length;
        result.verifiedRevision = image.revision === after.revision;
        if (
          !result.unrelatedPreserved ||
          result.textOverflow ||
          !result.verifiedRevision
        )
          throw new Error(
            `Canvas benchmark invariant failed for ${task.name}; no replay attempted.`
          );
        proof.results.push(result);
        await writeFile(output, JSON.stringify(proof, null, 2), {
          mode: 0o600,
        });
        console.log(JSON.stringify(result));
      }
} finally {
  await context.close();
}
// CDP browsers belong to the local preview; disconnect by ending this client.
process.exit(0);
