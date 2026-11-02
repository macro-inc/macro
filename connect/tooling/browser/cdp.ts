// Drive Connect's dedicated browser (tooling/browser/run.sh) over raw CDP.
// Usage (bun, inside `nix develop`):
//   bun connect/tooling/browser/cdp.ts <command> [args]
// Commands act on the first page tab unless CDP_TARGET names a URL substring:
//   tabs                       list page tabs
//   open <url>                 navigate and wait for load
//   url                        print the current URL
//   eval <js>                  evaluate an expression, print the JSON result
//   text [selector]            print visible text (default: body)
//   click <selector|text=...>  click an element's centre
//   type <text>                insert text into the focused element
//   key <Enter|Tab|...>        press one key
//   shot <path.png>            save a screenshot
//   wait <js> [seconds]        poll until the expression is truthy
// Never pass secrets as arguments; pipe them: `printf %s "$X" | cdp.ts type -`.

const endpoint = process.env.CDP_URL ?? 'http://localhost:9333';

type Tab = {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
};

async function pageTab(): Promise<Tab> {
  const tabs = (await (await fetch(`${endpoint}/json/list`)).json()) as Tab[];
  const pages = tabs.filter((t) => t.type === 'page');
  const want = process.env.CDP_TARGET;
  const tab = want ? pages.find((t) => t.url.includes(want)) : pages[0];
  if (!tab) throw new Error('no matching page tab');
  return tab;
}

function connect(tab: Tab) {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let next = 0;
  const pending = new Map<
    number,
    (m: { result?: unknown; error?: unknown }) => void
  >();
  const events: ((m: { method: string }) => void)[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id !== undefined) pending.get(m.id)?.(m);
    else for (const f of events) f(m);
  };
  const ready = new Promise<void>((r) => {
    ws.onopen = () => r();
  });
  // biome-ignore lint/suspicious/noExplicitAny: CDP results are untyped JSON.
  const send = async (method: string, params: object = {}): Promise<any> => {
    await ready;
    const id = ++next;
    ws.send(JSON.stringify({ id, method, params }));
    const m = await new Promise<{ result?: unknown; error?: unknown }>((r) =>
      pending.set(id, r),
    );
    if (m.error) throw new Error(`${method}: ${JSON.stringify(m.error)}`);
    return m.result;
  };
  return { send, events, close: () => ws.close() };
}

async function evaluate(
  // biome-ignore lint/suspicious/noExplicitAny: CDP results are untyped JSON.
  send: (m: string, p?: object) => Promise<any>,
  expression: string,
) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result.value;
}

const locate = (sel: string) => `(() => {
  const s = ${JSON.stringify(sel)};
  let el;
  if (s.startsWith('text=')) {
    // Prefer an exactly matching control, then the control around matching text.
    const want = s.slice(5).trim().toLowerCase();
    const visible = (e) => e.offsetParent !== null;
    const label = (e) => e.innerText.trim().toLowerCase();
    const controls = [...document.querySelectorAll('button,a,[role=button],[role=link],[role=option],input[type=submit],label')].filter(visible);
    el = controls.find((e) => label(e) === want) ?? controls.find((e) => label(e).includes(want));
    if (!el) {
      const leaf = [...document.querySelectorAll('body *')].filter(visible).filter((e) => label(e) === want).pop();
      el = leaf?.closest('button,a,[role=button],[role=link],li') ?? leaf;
    }
  } else el = document.querySelector(s);
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`;

async function readArg(arg: string | undefined) {
  if (arg === '-') return (await Bun.stdin.text()).replace(/\n$/, '');
  return arg ?? '';
}

const [cmd, ...args] = process.argv.slice(2);
const tab = await pageTab();
if (cmd === 'tabs') {
  const tabs = (await (await fetch(`${endpoint}/json/list`)).json()) as Tab[];
  for (const t of tabs.filter((t) => t.type === 'page')) console.log(t.url);
  process.exit(0);
}
const { send, events, close } = connect(tab);
try {
  switch (cmd) {
    case 'open': {
      await send('Page.enable');
      const loaded = new Promise<void>((r) =>
        events.push((m) => m.method === 'Page.loadEventFired' && r()),
      );
      await send('Page.navigate', { url: args[0] });
      await Promise.race([loaded, Bun.sleep(30_000)]);
      console.log(await evaluate(send, 'location.href'));
      break;
    }
    case 'url':
      console.log(await evaluate(send, 'location.href'));
      break;
    case 'eval':
      console.log(
        JSON.stringify(await evaluate(send, await readArg(args[0])), null, 2),
      );
      break;
    case 'text':
      console.log(
        await evaluate(
          send,
          `document.querySelector(${JSON.stringify(args[0] ?? 'body')})?.innerText ?? ''`,
        ),
      );
      break;
    case 'click': {
      const p = await evaluate(send, locate(args.join(' ')));
      if (!p) throw new Error(`not found: ${args.join(' ')}`);
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', {
          type,
          x: p.x,
          y: p.y,
          button: 'left',
          clickCount: 1,
        });
      break;
    }
    case 'type':
      await send('Input.insertText', { text: await readArg(args[0]) });
      break;
    case 'key': {
      const key = args[0];
      const codes: Record<string, number> = {
        Enter: 13,
        Tab: 9,
        Escape: 27,
        Backspace: 8,
      };
      const base = { key, code: key, windowsVirtualKeyCode: codes[key] ?? 0 };
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        ...base,
        ...(key === 'Enter' ? { text: '\r' } : {}),
      });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      break;
    }
    case 'shot': {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      await Bun.write(args[0], Buffer.from(r.data, 'base64'));
      console.log(args[0]);
      break;
    }
    case 'wait': {
      const deadline = Date.now() + Number(args[1] ?? 30) * 1000;
      while (!(await evaluate(send, args[0]).catch(() => false))) {
        if (Date.now() > deadline)
          throw new Error(`timed out waiting for ${args[0]}`);
        await Bun.sleep(500);
      }
      break;
    }
    default:
      throw new Error(`unknown command ${cmd}`);
  }
} finally {
  close();
}
