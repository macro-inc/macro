// Run with ANDROID_SERIAL=<dedicated emulator> bun tests/native/android/smoke.mjs.
// Uses the installed debug APK and its real native bridge; sends no messages.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { screenPointForInput, testShareTokens } from './smoke-utils.mjs';

const serial = process.env.ANDROID_SERIAL;
if (!serial)
  throw new Error('Set ANDROID_SERIAL to the dedicated test emulator');
const adb =
  process.env.ADB ??
  `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const output = process.env.ANDROID_SMOKE_OUTPUT ?? '/tmp/macro-task03-smoke';
const packageName = 'com.macro.app.prod';
const port = 9236;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function adbRun(...args) {
  const process = Bun.spawn([adb, '-s', serial, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const result = await new Response(process.stdout).arrayBuffer();
  if ((await process.exited) !== 0)
    throw new Error(await new Response(process.stderr).text());
  return new Uint8Array(result);
}
const text = (bytes) => new TextDecoder().decode(bytes).trim();
let socket;
let seq = 0;
const pending = new Map();
async function connect(waitForApp = false) {
  socket?.close();
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const pid = text(await adbRun('shell', 'pidof', packageName));
      await adbRun(
        'forward',
        `tcp:${port}`,
        `localabstract:webview_devtools_remote_${pid}`
      );
      const pages = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      const page = pages.find((page) => page.type === 'page');
      if (!page) throw new Error('WebView not ready');
      socket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = reject;
      });
      socket.onmessage = ({ data }) => {
        const response = JSON.parse(data);
        if (response.id) {
          pending.get(response.id)?.(response);
          pending.delete(response.id);
        }
      };
      for (let ready = 0; ready < 120; ready++) {
        if (
          await evaluate(
            `!!window.__TAURI_INTERNALS__ && !!document.documentElement.style.getPropertyValue('--dvh') && (${!waitForApp} || document.body.innerText.trim().length > 30)`
          )
        )
          return;
        await pause(500);
      }
      throw new Error('Macro did not initialize its native inset listener');
    } catch {
      socket?.close();
      await pause(500);
    }
  }
  throw new Error('Unable to connect to the debug WebView');
}
async function evaluate(expression, awaitPromise = true) {
  const id = ++seq;
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP timeout'));
    }, 30_000);
    pending.set(id, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise },
      })
    );
  });
  if (response.error || response.result?.exceptionDetails)
    throw new Error(JSON.stringify(response));
  return response.result.result.value;
}
const invoke = (command, args = {}) =>
  evaluate(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(`plugin:android-mobile|${command}`)},${JSON.stringify(args)})`
  );
const results = {};
const runId = crypto.randomUUID();
const imageName = `smoke-${runId}.png`;
const sharedText = `https://example.com/android-smoke/${runId}`;
const shareTokens = new Set();
let sharesStarted = false;
let exportToken;
let clipboardPath;

function trackShares(files) {
  for (const token of testShareTokens(files, { imageName, sharedText })) {
    shareTokens.add(token);
  }
  return files;
}

async function pendingShares() {
  return trackShares((await invoke('getPendingShares')).files);
}

async function discoverTestShares() {
  // The second batch may still be behind another share, or an assertion may
  // fail before its tokens reach JS. Read atomic manifests without dequeuing.
  // Wait for already-dispatched intents on the plugin's serial worker.
  await pendingShares();
  const directory = 'cache/android-share-inbox';
  const names = text(
    await adbRun('shell', 'run-as', packageName, 'ls', directory)
  );
  for (const name of names.split('\n')) {
    if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
    const files = JSON.parse(
      text(
        await adbRun(
          'shell',
          'run-as',
          packageName,
          'cat',
          `${directory}/${name}`
        )
      )
    );
    trackShares(files);
  }
}

await mkdir(output, { recursive: true });
await connect(true);
const keyboardSetting = text(
  await adbRun(
    'shell',
    'settings',
    'get',
    'secure',
    'show_ime_with_hard_keyboard'
  )
);
await adbRun(
  'shell',
  'settings',
  'put',
  'secure',
  'show_ime_with_hard_keyboard',
  '1'
);
const fontScale = text(
  await adbRun('shell', 'settings', 'get', 'system', 'font_scale')
);
const originalDensity = text(await adbRun('shell', 'wm', 'density'));
const densityOverride = originalDensity.match(/Override density: (\d+)/)?.[1];
const initialDensity = Number(
  densityOverride ?? originalDensity.match(/Physical density: (\d+)/)?.[1]
);
const originalSize = text(await adbRun('shell', 'wm', 'size'));
const sizeOverride = originalSize.match(/Override size: (\d+x\d+)/)?.[1];
const handwritingSetting = text(
  await adbRun(
    'shell',
    'settings',
    'get',
    'secure',
    'stylus_handwriting_enabled'
  )
);
await adbRun(
  'shell',
  'settings',
  'put',
  'secure',
  'stylus_handwriting_enabled',
  '0'
);
try {
  assert.equal(
    (await invoke('getPendingShares')).files.length,
    0,
    'Do not run with a pending personal share'
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('[role=dialog]').length`),
    0,
    'Close open dialogs before the keyboard probe'
  );
  const start = await invoke('getInsets');
  assert.ok(start.viewportHeight > 0);
  await evaluate(`(() => {
    const field = document.createElement('textarea'); field.id='android-smoke-input';
    field.setAttribute('aria-label','Android smoke test');
    field.value='Unsent Android draft';
    field.style.cssText='position:fixed;top:100px;left:20px;width:300px;height:80px;z-index:2147483647;background:white;color:black;font-size:20px';
    document.body.append(field);
  })()`);
  const geometry = await evaluate(`(() => {
    const rect = document.getElementById('android-smoke-input').getBoundingClientRect();
    const viewport = window.visualViewport;
    return {rect: {left:rect.left,top:rect.top,width:rect.width,height:rect.height},
      viewport: {left:viewport?.offsetLeft ?? 0,top:viewport?.offsetTop ?? 0,
        width:viewport?.width ?? innerWidth,height:viewport?.height ?? innerHeight}};
  })()`);
  const hierarchyPath = `/data/local/tmp/macro-android-smoke-${runId}.xml`;
  let hierarchy;
  try {
    await adbRun('shell', 'uiautomator', 'dump', hierarchyPath);
    hierarchy = text(await adbRun('shell', 'cat', hierarchyPath));
  } finally {
    await adbRun('shell', 'rm', '-f', hierarchyPath);
  }
  const { x, y } = screenPointForInput(hierarchy, packageName, geometry);
  await adbRun('shell', 'input', 'tap', String(x), String(y));
  let shown;
  for (let attempt = 0; attempt < 40; attempt++) {
    shown = await invoke('getInsets');
    if (shown.imeVisible && shown.imeHeight > 0) break;
    await pause(500);
  }
  await writeFile(
    `${output}/keyboard.png`,
    await adbRun('exec-out', 'screencap', '-p')
  );
  assert.equal(shown.imeVisible, true);
  assert.ok(
    Math.abs(shown.viewportHeight - start.viewportHeight) < 1,
    'IME must not resize the WebView; the layout root shrinks through --dvh'
  );
  const css = await evaluate(
    `(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;height:calc(var(--dvh)*100);pointer-events:none';
      document.body.append(probe);
      const dvh = probe.getBoundingClientRect().height;
      probe.remove();
      return {dvh,offset:document.documentElement.style.getPropertyValue('--virtual-keyboard-height')};
    })()`
  );
  assert.ok(
    Math.abs(css.dvh - (shown.viewportHeight - shown.imeHeight)) < 1,
    'The layout root must shrink by exactly the keyboard height'
  );
  assert.ok(
    Math.abs(Number.parseFloat(css.offset) - shown.imeHeight) < 1,
    'Fixed sheets lift by the keyboard height'
  );
  await adbRun('shell', 'input', 'keyevent', '4');
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!(await invoke('getInsets')).imeVisible) break;
    await pause(500);
  }
  assert.equal((await invoke('getInsets')).imeVisible, false);
  assert.equal(
    await evaluate(`document.getElementById('android-smoke-input').value`),
    'Unsent Android draft'
  );
  results.keyboard = { start, shown, css, backPreservedDraft: true };
  console.log('Keyboard overlay and Back passed');

  // Font/display settings previously recreated the Activity while the native
  // plugin retained the old WebView, stranding its insets and the open draft.
  await adbRun(
    'shell',
    'settings',
    'put',
    'system',
    'font_scale',
    fontScale === '1.3' ? '1.0' : '1.3'
  );
  await pause(1500);
  assert.equal(
    await evaluate(`document.getElementById('android-smoke-input')?.value`),
    'Unsent Android draft'
  );
  const configured = await invoke('getInsets');
  const actualHeight = await evaluate('innerHeight');
  assert.ok(
    Math.abs(configured.viewportHeight - actualHeight) < 2,
    'Native insets must follow the current WebView after configuration changes'
  );
  results.configuration = {
    fontScalePreservedWebViewAndDraft: true,
    configured,
    actualHeight,
  };
  await adbRun(
    'shell',
    'settings',
    'put',
    'system',
    'font_scale',
    fontScale === 'null' ? '1.0' : fontScale
  );
  await pause(500);
  await evaluate(
    `document.getElementById('android-smoke-input').style.top = 'calc(var(--dvh)*100 - 100px)'`
  );
  await adbRun(
    'shell',
    'wm',
    'density',
    initialDensity === 240 ? '420' : '240'
  );
  await pause(1500);
  const resized = await evaluate(`(() => {
    const field = document.getElementById('android-smoke-input');
    return {height:innerHeight,bottom:field.getBoundingClientRect().bottom,draft:field.value,
      topInset:parseFloat(document.documentElement.style.getPropertyValue('--tauri-inset-top'))};
  })()`);
  assert.equal(resized.draft, 'Unsent Android draft');
  assert.ok(
    Math.abs(resized.height - resized.bottom - 20) < 2,
    'Display density changes must keep bottom composers inside the CSS viewport'
  );
  const densityInsets = await invoke('getInsets');
  assert.ok(
    Math.abs(
      resized.topInset -
        (densityInsets.top * resized.height) / densityInsets.viewportHeight
    ) < 1,
    'Safe areas must use the current CSS pixel scale after a density change'
  );
  results.configuration.displayDensityPreservedComposer = true;
  results.windowSizes = [];
  for (const size of ['1600x2560', '1350x1800']) {
    await adbRun('shell', 'wm', 'size', size);
    await pause(1000);
    const viewport = await evaluate(`(() => {
      const field = document.getElementById('android-smoke-input');
      return {width:innerWidth,height:innerHeight,bottom:field.getBoundingClientRect().bottom,draft:field.value};
    })()`);
    assert.equal(viewport.draft, 'Unsent Android draft');
    assert.ok(Math.abs(viewport.height - viewport.bottom - 20) < 2);
    results.windowSizes.push({ size, ...viewport });
  }
  await adbRun('shell', 'wm', 'size', sizeOverride ?? 'reset');
  await adbRun('shell', 'wm', 'density', densityOverride ?? 'reset');
  await pause(500);
  await evaluate(`document.getElementById('android-smoke-input').remove()`);

  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const { token } = await invoke('beginExport', {
    name: imageName,
    mimeType: 'image/png',
    size: 68,
  });
  exportToken = token;
  await invoke('appendExport', { token, data: png });
  await invoke('finishExport', { token, action: 'copy' });
  const clipboard = await invoke('stageClipboardImage');
  clipboardPath = clipboard.previewPath;
  assert.equal(clipboard.size, 68);
  assert.equal(clipboard.mimeType, 'image/png');
  const copied = await adbRun(
    'shell',
    'run-as',
    packageName,
    'cat',
    clipboard.previewPath
  );
  assert.equal(Buffer.from(copied).toString('base64'), png);
  results.clipboard = { exactBytes: true, size: clipboard.size };
  console.log('Clipboard bytes passed');

  const uri = `content://${packageName}.fileprovider/exports/${token}/${imageName}`;
  sharesStarted = true;
  await adbRun(
    'shell',
    'am',
    'start',
    '-n',
    `${packageName}/.MainActivity`,
    '-a',
    'android.intent.action.SEND',
    '-t',
    'image/png',
    '--eu',
    'android.intent.extra.STREAM',
    uri
  );
  await pause(500);
  const first = await pendingShares();
  assert.equal(first.length, 1);
  assert.equal(first[0].name, imageName);
  assert.equal(first[0].size, 68);
  let uploaded;
  const receiver = Bun.serve({
    hostname: '127.0.0.1',
    port: 9237,
    async fetch(request) {
      uploaded = {
        bytes: Buffer.from(await request.arrayBuffer()).toString('base64'),
        checksum: request.headers.get('x-amz-checksum-sha256'),
      };
      return new Response(null, { status: 200 });
    },
  });
  try {
    const checksum = Buffer.from(first[0].sha256, 'hex').toString('base64');
    await evaluate(
      `window.__TAURI_INTERNALS__.invoke('upload_staged_file_to_presigned_url', ${JSON.stringify(
        {
          source: 'share',
          token: first[0].token,
          uploadUrl: 'http://10.0.2.2:9237/upload',
          mimeType: first[0].mimeType,
          checksumSha256: checksum,
        }
      )})`
    );
    assert.deepEqual(uploaded, { bytes: png, checksum });
    results.nativeUpload = { exactBytes: true, checksumHeader: true };
    console.log('Native streaming PUT and checksum passed');
  } finally {
    receiver.stop(true);
  }
  assert.equal((await pendingShares())[0].token, first[0].token);
  await adbRun(
    'shell',
    'am',
    'start',
    '-n',
    `${packageName}/.MainActivity`,
    '-a',
    'android.intent.action.SEND',
    '-t',
    'text/plain',
    '--es',
    'android.intent.extra.TEXT',
    sharedText
  );
  await pause(500);
  assert.equal(
    (await pendingShares())[0].token,
    first[0].token,
    'Second share must not replace an open draft'
  );
  await adbRun('shell', 'am', 'force-stop', packageName);
  await adbRun('shell', 'am', 'start', '-n', `${packageName}/.MainActivity`);
  await connect();
  assert.equal(
    (await pendingShares())[0].token,
    first[0].token,
    'Cold startup retains the share exactly once'
  );
  await invoke('clearShares', {
    tokens: testShareTokens(first, { imageName, sharedText }),
  });
  const second = await pendingShares();
  assert.equal(second.length, 1);
  assert.equal(second[0].sharedText, sharedText);
  await invoke('clearShares', {
    tokens: testShareTokens(second, { imageName, sharedText }),
  });
  assert.equal((await invoke('getPendingShares')).files.length, 0);
  results.shares = { queued: true, survivedColdStart: true, cleared: true };
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  // A failure in one cleanup must not skip the others or display restoration.
  const clean = async (action) => {
    try {
      await action();
    } catch (error) {
      console.error('Smoke cleanup failed:', error);
      process.exitCode = 1;
    }
  };
  if (sharesStarted) {
    await clean(discoverTestShares);
  }
  if (shareTokens.size > 0) {
    await clean(() => invoke('clearShares', { tokens: [...shareTokens] }));
  }
  if (clipboardPath) {
    await clean(() =>
      adbRun('shell', 'run-as', packageName, 'rm', '-f', clipboardPath)
    );
  }
  if (exportToken) {
    await clean(() => invoke('discardExport', { token: exportToken }));
    // Finished exports are no longer in the plugin's active map, and the map
    // is lost on restart. Remove just this run's export directory.
    await clean(() =>
      adbRun(
        'shell',
        'run-as',
        packageName,
        'rm',
        '-rf',
        `cache/android-exports/${exportToken}`
      )
    );
  }
  try {
    await evaluate(`document.getElementById('android-smoke-input')?.remove()`);
  } catch {}
  await adbRun(
    'shell',
    'settings',
    'put',
    'secure',
    'show_ime_with_hard_keyboard',
    keyboardSetting === 'null' ? '0' : keyboardSetting
  );
  await adbRun(
    'shell',
    'settings',
    'put',
    'secure',
    'stylus_handwriting_enabled',
    handwritingSetting === 'null' ? '1' : handwritingSetting
  );
  await adbRun(
    'shell',
    'settings',
    'put',
    'system',
    'font_scale',
    fontScale === 'null' ? '1.0' : fontScale
  );
  await adbRun('shell', 'wm', 'density', densityOverride ?? 'reset');
  await adbRun('shell', 'wm', 'size', sizeOverride ?? 'reset');
  socket?.close();
}
