// Run as macro on the real Xvnc desktop. Requires playwright-core, and
// firefox + geckodriver on PATH for measure. Last stdout line is JSON.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { performance } from 'node:perf_hooks';

const mode = process.argv[2];
const cdp = process.env.E2E_CDP ?? 'http://127.0.0.1:9222';
const pageUrl = process.env.E2E_PAGE_URL ?? 'https://example.com/';
const output = {};
const fixture = `<!doctype html><title>Guest WebGL benchmark</title><canvas width="1280" height="720"></canvas><script>
window.result = new Promise((resolve, reject) => {
 const gl = document.querySelector('canvas').getContext('webgl');
 if (!gl) { reject(Error('WebGL unavailable')); return; }
 const ext = gl.getExtension('WEBGL_debug_renderer_info');
 const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
 const shader = (type, source) => { const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s; };
 const program=gl.createProgram();
 gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}'));
 gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float; uniform float t; void main(){gl_FragColor=vec4(abs(sin(gl_FragCoord.x*.01+t)),abs(cos(gl_FragCoord.y*.01+t)),.5,1.);}'));
 gl.linkProgram(program); if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program)); gl.useProgram(program);
 gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const p=gl.getAttribLocation(program,'p'); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
 const t=gl.getUniformLocation(program,'t'); let frames=0; const start=performance.now();
 function frame(now){ gl.uniform1f(t,now/1000); for(let i=0;i<64;i++) gl.drawArrays(gl.TRIANGLES,0,3); gl.finish(); frames++; if(now-start<3000) requestAnimationFrame(frame); else resolve({frames,seconds:(now-start)/1000,fps:frames*1000/(now-start),renderer,error:gl.getError()}); }
 requestAnimationFrame(frame);
});</script>`;

async function memory(pid) {
  if (!Number.isInteger(pid) || pid < 1) throw Error('Browser PID unavailable');
  const processes = new Map();
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = await readFile(`/proc/${entry}/status`, 'utf8');
      processes.set(Number(entry), { ppid: Number(status.match(/^PPid:\s+(\d+)/m)[1]), rss: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0) });
    } catch { /* Process exited during collection. */ }
  }
  const selected = new Set([pid]);
  for (let previous = -1; previous !== selected.size;) {
    previous = selected.size;
    for (const [child, data] of processes) if (selected.has(data.ppid)) selected.add(child);
  }
  let rss = 0, pss = 0, pssProcesses = 0;
  for (const child of selected) {
    rss += processes.get(child)?.rss ?? 0;
    try {
      const rollup = await readFile(`/proc/${child}/smaps_rollup`, 'utf8');
      pss += Number(rollup.match(/^Pss:\s+(\d+)/m)[1]);
      pssProcesses++;
    } catch { /* Some guest kernels restrict smaps. RSS remains available. */ }
  }
  return { rss_kib: rss, pss_kib: pssProcesses === selected.size ? pss : null, processes: selected.size };
}

async function chromiumMeasure(browser, name, pid, url) {
  const page = await browser.newPage();
  try {
    const start = performance.now();
    await page.goto(pageUrl, { waitUntil: 'load', timeout: 60000 });
    const loadMs = performance.now() - start;
    const title = await page.title();
    if (!title) throw Error('Real page has no title');
    await page.goto(url);
    const webgl = await page.evaluate(() => Promise.race([
      window.result,
      new Promise((_resolve, reject) => setTimeout(() => reject(Error('WebGL workload timeout')), 30000)),
    ]));
    if (webgl.error || webgl.frames < 1 || !/swiftshader|llvmpipe|softpipe/i.test(webgl.renderer)) throw Error(`Software WebGL failed: ${JSON.stringify(webgl)}`);
    output[name] = { ok: true, version: browser.version(), page_url: pageUrl, title, load_ms: loadMs, webgl, memory: await memory(pid) };
  } finally { await page.close(); }
}

async function webdriver(base, method, path, body) {
  const response = await fetch(`${base}${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000) });
  const value = (await response.json()).value;
  if (!response.ok || value?.error) throw Error(JSON.stringify(value));
  return value;
}

async function firefoxMeasure(url) {
  const mesa = process.env.E2E_MESA;
  if (!mesa) throw Error('E2E_MESA must point to the realized Mesa package');
  const driver = spawn('geckodriver', ['--port', '4445'], { env: {
    ...process.env, DISPLAY: ':0', LIBGL_ALWAYS_SOFTWARE: '1', GALLIUM_DRIVER: 'llvmpipe',
    MOZ_WEBRENDER: '1', MOZ_ENABLE_WAYLAND: '0', MOZ_X11_EGL: '1',
    LIBGL_DRIVERS_PATH: `${mesa}/lib/dri`,
    LD_LIBRARY_PATH: `${mesa}/lib:${process.env.LD_LIBRARY_PATH ?? ''}`,
    __EGL_VENDOR_LIBRARY_FILENAMES: `${mesa}/share/glvnd/egl_vendor.d/50_mesa.json`,
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => driver.once('close', resolve));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('geckodriver readiness timeout')), 30000);
    driver.on('error', error => { clearTimeout(timer); reject(error); });
    driver.on('exit', code => { clearTimeout(timer); reject(Error(`geckodriver exited ${code}`)); });
    for (const stream of [driver.stdout, driver.stderr]) stream.on('data', data => {
      process.stderr.write(data);
      if (data.toString().includes('Listening on')) { clearTimeout(timer); resolve(); }
    });
  });
  let session;
  const base = 'http://127.0.0.1:4445';
  try {
    await ready;
    session = await webdriver(base, 'POST', '/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { prefs: { 'webgl.force-enabled': true, 'gfx.webrender.software': true } } } } });
    const path = `/session/${session.sessionId}`;
    const start = performance.now();
    await webdriver(base, 'POST', `${path}/url`, { url: pageUrl });
    const loadMs = performance.now() - start;
    const title = await webdriver(base, 'GET', `${path}/title`);
    if (!title) throw Error('Real page has no title');
    output.firefox_headful = { ok: false, version: session.capabilities.browserVersion, page_url: pageUrl, title, load_ms: loadMs, memory: await memory(session.capabilities['moz:processID']) };
    await webdriver(base, 'POST', `${path}/url`, { url });
    const webgl = await webdriver(base, 'POST', `${path}/execute/async`, { script: 'const done=arguments[arguments.length-1]; window.result.then(done,e=>done({error:String(e)}));', args: [] });
    if (webgl.error || webgl.frames < 1 || !/swiftshader|llvmpipe|softpipe/i.test(webgl.renderer)) throw Error(`Software WebGL failed: ${JSON.stringify(webgl)}`);
    output.firefox_headful = { ok: true, version: session.capabilities.browserVersion, page_url: pageUrl, title, load_ms: loadMs, webgl, memory: await memory(session.capabilities['moz:processID']) };
  } finally {
    if (session) await webdriver(base, 'DELETE', `/session/${session.sessionId}`).catch(error => console.error(error));
    driver.kill();
    const killTimer = setTimeout(() => driver.kill('SIGKILL'), 5000);
    await closed;
    clearTimeout(killTimer);
  }
}

let failed = false;
async function check(name, action) {
  try { await action(); } catch (error) { failed = true; output[name] = { ...output[name], ok: false, error: String(error) }; }
}

if (mode === 'prepare' || mode === 'restore') {
  await check('browser_persistence', async () => {
    const browser = await chromium.connectOverCDP(cdp);
    try {
      const context = browser.contexts()[0];
      if (mode === 'prepare') {
        const page = await context.newPage();
        await page.goto(pageUrl, { waitUntil: 'load', timeout: 60000 });
        const token = crypto.randomUUID();
        await page.evaluate(value => { window.__guestE2EToken = value; }, token);
        await writeFile('browser-state.json', JSON.stringify({ token, url: page.url(), title: await page.title() }));
      } else {
        const saved = JSON.parse(await readFile('browser-state.json', 'utf8'));
        let found = false;
        for (const page of context.pages()) {
          if (page.url() === saved.url && await page.title() === saved.title && await page.evaluate(() => window.__guestE2EToken) === saved.token) {
            await page.bringToFront();
            await page.evaluate(() => Promise.race([
              new Promise(resolve => requestAnimationFrame(() => resolve(true))),
              new Promise((_resolve, reject) => setTimeout(() => reject(Error('Restored tab stopped rendering')), 15000)),
            ]));
            found = true;
          }
        }
        if (!found) throw Error('Original live tab and in-memory token did not survive');
      }
      output.browser_persistence = { ok: true, mode };
    } finally { await browser.close(); }
  });
} else if (mode === 'measure') {
  await check('vnc_desktop', () => new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: 5900 });
    socket.setTimeout(10000);
    socket.once('error', reject);
    socket.once('timeout', () => { socket.destroy(); reject(Error('VNC banner timeout')); });
    socket.once('data', data => {
      socket.destroy();
      const banner = data.toString();
      if (!banner.startsWith('RFB ')) { reject(Error('Invalid VNC banner')); return; }
      output.vnc_desktop = { ok: true, banner: banner.trim(), display: ':0' };
      resolve();
    });
  }));
  const server = createServer((_request, response) => response.end(fixture));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    for (const headless of [true, false]) {
      const name = headless ? 'chromium_headless' : 'chromium_headful';
      await check(name, async () => {
        const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? '/run/current-system/sw/bin/chromium', headless, env: { ...process.env, DISPLAY: ':0', LIBGL_ALWAYS_SOFTWARE: '1' }, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
        try {
          const session = await browser.newBrowserCDPSession();
          const { processInfo } = await session.send('SystemInfo.getProcessInfo');
          await chromiumMeasure(browser, name, processInfo.find(process => process.type === 'browser').id, url);
        } finally { await browser.close(); }
      });
    }
    await check('firefox_headful', () => firefoxMeasure(url));
  } finally { server.close(); }
} else {
  throw Error(`Unknown mode: ${mode}`);
}
console.log(JSON.stringify({ mode, ok: !failed, checks: output }));
process.exitCode = failed ? 1 : 0;
