// Run with Bun: bun .github/readme/feature-graphics.mjs /path/to/refresh/apps/marketing
// Render the website's existing product components, not approximated SVG screens.
import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const marketing = resolve(process.argv[2] || 'apps/marketing');
const output = resolve(dirname(fileURLToPath(import.meta.url)), 'features');
const require = createRequire(join(marketing, 'package.json'));
const { chromium } = require('@playwright/test');
const port = 4188;
const keys = ['email','messages','tasks','docs','canvas','agents','calls','files','pull-requests','crm'];

const source = `import { render, Dynamic } from "solid-js/web";
import "./src/app/main/index.css";
import "./.readme-capture.css";
import "./src/styles/dark-theme.css";
import "./src/app/routes/RouteAgents.css";
import { MultiInboxSpotlight } from "./src/app/components/featureGraphics/EmailGraphics";
import { CallStageGraphic } from "./src/app/components/featureGraphics/CallsGraphics";
import "./src/features/marketing/components/homepage-pipeline-demo.css";
import { TaskGithubDemo } from "./src/features/marketing/components/tasks/TaskStories";
import "./src/features/marketing/components/tasks/tasks-page.css";

import { HeroDocWindow } from "./src/app/components/featureGraphics/DocumentsGraphics";
import { ChannelPreviewGraphic } from "./src/app/components/featureGraphics/ChannelPreviewGraphic";
import { FolderComposerMockup } from "./src/features/marketing/components/agents/FolderComposerMockup";
import { HomepageConversation } from "./src/features/marketing/components/HomepageConversation";
import {
	CompanyKanbanCardSurface,
	CompanyKanbanColumn,
} from "./src/features/marketing/components/DemoCompanyKanban";
import { homepagePeople } from "./src/features/marketing/core/homepage-demo-people";
import { For } from "solid-js";
import { Button } from "./src/ui/index";
import Cursor from "../../node_modules/@phosphor-icons/core/assets/regular/cursor.svg";
import Hand from "../../node_modules/@phosphor-icons/core/assets/regular/hand.svg";
import Rectangle from "../../node_modules/@phosphor-icons/core/assets/regular/rectangle.svg";
import Circle from "../../node_modules/@phosphor-icons/core/assets/regular/circle.svg";
import Arrow from "../../node_modules/@phosphor-icons/core/assets/regular/arrow-up-right.svg";
import Pencil from "../../node_modules/@phosphor-icons/core/assets/regular/pencil-simple.svg";
import Eraser from "../../node_modules/@phosphor-icons/core/assets/regular/eraser.svg";
import Text from "../../node_modules/@phosphor-icons/core/assets/regular/text-t.svg";
import Clip from "../../node_modules/@phosphor-icons/core/assets/regular/paperclip.svg";
import "./src/features/marketing/components/workspace-story.css";

const companies = [
	["Lead", ["Acme Robotics", "Northstar Studio", "Cedar Analytics"]],
	["Demo", ["Orbit Design Co", "Meadow Labs", "Lumen Supply"]],
	["Customer", ["Summit Workshop", "Juniper Creative", "Atlas Fieldworks"]],
];
function Pipeline() {
	return (
		<div class="pipeline portal-scope">
			<header>
				Sales Demo <span>Companies · Pipeline</span>
			</header>
			<div class="columns">
				<For each={companies}>
					{([stage, names], i) => (
						<CompanyKanbanColumn
							label={stage}
							icon={
								<span style={{ color: ["#60a5fa", "#c084fc", "#4ade80"][i()] }}>
									●
								</span>
							}
						>
							<For each={names}>
								{(name, j) => (
									<CompanyKanbanCardSurface
										icon={<span style={{ color: "#aaa" }}>{name[0]}</span>}
										title={name}
										owner={
											<img
												class="ml-auto size-5 rounded-full"
												src={homepagePeople.julia.photo}
											/>
										}
										domain={
											<span>{["$24,000", "$36,000", "$48,000"][j()]}</span>
										}
										updatedAt={<span class="ml-auto">Today</span>}
									/>
								)}
							</For>
						</CompanyKanbanColumn>
					)}
				</For>
			</div>
		</div>
	);
}
function Canvas() {
	return (
		<div class="canvas portal-scope">
			<header>
				Launch workspace <span>Share　 ▥</span>
			</header>
			<div class="canvas-surface">
				<svg class="connections" viewBox="0 0 900 500">
					<path
						d="M340 170 C460 170 450 320 550 320"
						fill="none"
						stroke="#a3a3a3"
						stroke-width="2"
					/>
					<path
						d="M340 170 C420 170 420 100 570 100"
						fill="none"
						stroke="#a3a3a3"
						stroke-width="2"
					/>
				</svg>
				<div class="canvas-note">
					<b>Launch ideas</b>
					<p>Make the first five minutes feel effortless.</p>
					<p>
						✓ A clear starting point
						<br />✓ Everything in one place
					</p>
				</div>
				<div class="canvas-node">
					<span style={{ color: "#b597f8" }}>▤</span> Website launch plan
					<p>Everything we need before Thursday.</p>
				</div>
				<div class="canvas-task">
					<span style={{ color: "#5bd799" }}>☷</span> Update the welcome flow
					<p>◐ In Progress　 ·　 Julia</p>
				</div>
				<div class="canvas-tools">
					<div
						class="flex gap-1 rounded-full border border-edge-muted bg-surface p-2"
						aria-label="Drawing tools"
					>
						<For
							each={[
								Cursor,
								Hand,
								Rectangle,
								Circle,
								Arrow,
								Pencil,
								Eraser,
								Text,
								Clip,
							]}
						>
							{(Tool, i) => (
								<Button
									size="icon-md"
									label="Drawing tool"
									variant={i() === 0 ? "cta" : "ghost"}
								>
									<Tool />
								</Button>
							)}
						</For>
					</div>
				</div>
			</div>
		</div>
	);
}
import { AgentThreadGraphic } from "./src/app/components/featureGraphics/AgentThreadGraphic";
import { DemoPrDocument } from "./src/features/marketing/components/DemoPrDocument";
function PullRequest() {
	return (
		<div class="pr-panel portal-scope">
			<header>
				Pull requests <span>Share　 ▥</span>
			</header>
			<main>
				<DemoPrDocument merged />
			</main>
		</div>
	);
}
const scenes = {
	tasks: TaskGithubDemo,
	docs: HeroDocWindow,
	email: MultiInboxSpotlight,
	messages: ChannelPreviewGraphic,
	agents: AgentThreadGraphic,
	calls: CallStageGraphic,
	"pull-requests": PullRequest,
	crm: Pipeline,
	files: FolderComposerMockup,
	canvas: Canvas,
};
const key = new URLSearchParams(location.search).get("scene") || "tasks";
const overlays = {
	tasks: "The sign-in button does nothing on mobile. Can you fix it?",
	docs: "@Claude Add the launch steps we agreed on in this channel.",
	files: "The proposal and launch assets are ready for the team.",
};
render(
	() => (
		<>
			<div id="capture" data-scene={key}>
				<div class="glow" />
				<div id="scene">
					<Dynamic component={scenes[key]} paused={true} />
				</div>
				{overlays[key] && (
					<div class="message">
						<HomepageConversation
							messages={[{ person: "julia", text: overlays[key] }]}
						/>
					</div>
				)}
			</div>
		</>
	),
	document.getElementById("root")!,
);
`;

const css = `@import "./src/styles/site-ui.css";
@source "./src";
@source "./.readme-capture.tsx";
html,body{margin:0;background:#000;color:#eee;font-family:Inter,sans-serif}
#capture{width:1200px;height:800px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000;position:relative}
.glow{position:absolute;width:1050px;height:620px;background:radial-gradient(ellipse, #77b4bc18,transparent 65%);mask-image:radial-gradient(#000,transparent);background-size:auto;}
.glow:after{content:'';position:absolute;inset:0;background-image:radial-gradient(#7a9baa44 .8px,transparent .8px);background-size:12px 12px}
#scene{width:1000px;flex:none;position:relative;transform:perspective(2200px) rotateY(-3deg) rotateZ(-1deg);filter:drop-shadow(0 20px 40px #0008)}
[data-scene=tasks] #scene{width:870px;zoom:1.15;margin-top:-85px}
[data-scene=tasks] .product-demo-stage,[data-scene=tasks] .product-demo{height:520px!important;min-height:520px!important;border-radius:24px!important;overflow:hidden!important;border:1px solid #353535!important}
.message{position:absolute;right:50px;bottom:60px;width:820px;background:#111;border:1px solid #363636;border-radius:24px;padding:20px 25px;box-shadow:0 20px 45px #0008;transform:rotate(1deg);font-size:20px;}
.message .homepage-conversation{margin:0;padding:0;gap:0}.message .homepage-message{margin:0}
[data-scene=docs] #scene{width:920px;zoom:1.08;max-height:570px;overflow:hidden;border:1px solid #333;border-radius:24px;margin-top:-85px}
[data-scene=email] #scene{width:900px;zoom:1.18}
[data-scene=messages] #scene{width:1080px;zoom:1.03}
[data-scene=agents] #scene{width:940px;zoom:1.12}
[data-scene=calls] #scene{width:1020px;zoom:1.05}
[data-scene=pull-requests] #scene{width:820px;zoom:1.3}
[data-scene=files] #scene{width:600px;zoom:1.1;margin-top:-95px}
.agent-folder-mockup{width:600px;height:480px;background:#111;border:1px solid #353535;border-radius:22px;overflow:hidden}
.pipeline,.canvas{background:#101010;border:1px solid #373737;border-radius:24px;overflow:hidden}
.pipeline header,.canvas header{height:65px;padding:20px 25px;border-bottom:1px solid #252525;font-size:19px}.pipeline header span,.canvas header span{float:right;color:#aaa;font-size:15px}
.columns{display:flex;gap:14px;padding:20px;height:440px}.columns>div{min-width:0}.columns .text-sm{font-size:17px}.columns .text-xs{font-size:14px}.columns .bg-surface{padding:16px 12px;gap:12px}
.canvas-surface{position:relative;height:500px;background-image:radial-gradient(#6666 1px,transparent 1px);background-size:20px 20px}.connections{position:absolute;inset:0;width:100%;height:100%}.canvas-note,.canvas-node,.canvas-task{position:absolute;border:1px solid #444;border-radius:12px;background:#171717;padding:24px;font-size:19px;box-shadow:0 10px 20px #0005}.canvas-note{left:55px;top:65px;width:285px;background:#302a16;border-color:#66572a;transform:rotate(-2deg)}.canvas-note p,.canvas-node p,.canvas-task p{font-size:16px;line-height:1.65;color:#bbb;margin-top:16px}.canvas-node{left:550px;top:45px;width:330px}.canvas-task{left:535px;top:280px;width:355px}.canvas-tools{position:absolute;bottom:20px;left:50%;transform:translateX(-50%)}

.message .homepage-message{max-width:100%;width:100%}.message [data-user-message-bubble]{font-size:22px;line-height:1.55}.message .homepage-message-name{font-size:16px}
[data-scene=email] #scene [style*="opacity: 0.42"]{opacity:1!important}
[data-scene=agents] #scene{background:#080808;border-radius:20px;padding:15px;width:950px;zoom:1.05;border:1px solid #333}
[data-scene=pull-requests] #scene{width:900px;zoom:1.1}
.pr-panel{border:1px solid #353535;border-radius:24px;overflow:hidden;background:#111}.pr-panel header{padding:20px 25px;border-bottom:1px solid #222;font-size:17px}.pr-panel header span{float:right;color:#aaa}.pr-panel main{padding:40px 50px}.pr-panel .text-sm{font-size:17px;line-height:1.6}

[data-scene=messages] .cpg-leads,[data-scene=messages] .cpg-note{display:none!important}
[data-scene=email] #scene>div>div[aria-hidden=true]{opacity:.85!important;background:#090909}
`;

const files = [
  ['.readme-capture.tsx', source],
  ['.readme-capture.css', css],
  ['.readme-capture.html', '<html><div id="root"></div><script type="module" src="/.readme-capture.tsx"></script></html>'],
];
// Never overwrite a user's files. Remove only files created by this invocation.
for (const [name] of files) {
  try { await access(join(marketing, name)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  throw new Error(`Temporary capture file already exists: ${name}`);
}
const created = [];
let server, browser;
try {
  for (const [name, contents] of files) {
    await writeFile(join(marketing, name), contents, { flag: 'wx' });
    created.push(name);
  }
  server = spawn(process.execPath, ['--bun', join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: marketing, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('Vite startup timed out')), 30000);
    const data = chunk => { if (chunk.toString().includes('Local:')) { clearTimeout(timer); done(); } };
    server.stdout.on('data', data);
    server.stderr.on('data', chunk => process.stderr.write(chunk));
    server.once('error', error => { clearTimeout(timer); fail(error); });
    server.once('exit', code => { clearTimeout(timer); fail(new Error(`Vite exited: ${code}`)); });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir(output, { recursive: true });
  for (const key of keys) {
    await page.goto(`http://127.0.0.1:${port}/.readme-capture.html?scene=${key}`, { waitUntil: 'networkidle' });
    await page.locator('#scene').waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    if (errors.length) throw new Error(errors.join('\n'));
    await page.locator('#capture').screenshot({ path: join(output, `${key}.jpg`), type: 'jpeg', quality: 94, animations: 'disabled' });
    console.log(`Captured ${key}`);
  }
} finally {
  await browser?.close();
  server?.kill();
  for (const name of created) await unlink(join(marketing, name));
}
