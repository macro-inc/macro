import { expect, test } from "bun:test";
import { Macro } from "@macro-inc/sdk";
import { defaultDashboard, ensureHomeDashboard } from "../index.ts";

const agentId = "macro|agent@example.com";

/** The real SDK client with the namespaces under test replaced, so nothing reaches the network. */
const fakeMacro = (parts: Readonly<{ dashboards?: object; me?: object }>) =>
	Object.assign(new Macro({ auth: { type: "user", apiKey: "test" } }), {
		users: { me: async () => ({ id: agentId }) },
		...parts,
	});

const context = (macro: Macro) => {
	const files = new Map<string, string>();
	const events: object[] = [];
	return {
		files,
		events,
		join: (...parts: readonly string[]) => parts.join("/"),
		state: { memory: (owner: string) => `/state/memory/${owner}` },
		disk: {
			read: async (path: string) => files.get(path),
			write: async (path: string, text: string) => {
				files.set(path, text);
			},
			exists: async (path: string) => files.has(path),
		},
		log: {
			event: async (_stream: string, entry: object) => {
				events.push(entry);
			},
		},
		macro: async () => macro,
	};
};

test("a new agent creates the default dashboard once and makes it its home", async () => {
	const created: unknown[] = [];
	const homes: unknown[] = [];
	const dashboard = { id: "d-1", webUrl: () => "https://macro.com/app/dashboard/d-1" };
	const macro = fakeMacro({
		dashboards: {
			create: async (view: unknown) => {
				created.push(view);
				return dashboard;
			},
		},
		me: {
			homeDashboard: async () => undefined,
			setHomeDashboard: async (home: unknown) => {
				homes.push(home);
			},
		},
	});
	const fake = context(macro);

	expect(await ensureHomeDashboard(fake)).toEqual({ kind: "created" });
	expect(created).toEqual([defaultDashboard(agentId)]);
	expect(homes).toEqual([dashboard]);
	expect(await ensureHomeDashboard(fake)).toEqual({ kind: "existing" });
	expect(created).toHaveLength(1);
});

test("a dashboard created by a run that failed before making it the home is reused, not orphaned", async () => {
	const created: unknown[] = [];
	const homes: string[] = [];
	let failNextHome = true;
	const handle = (id: string) => ({
		id,
		webUrl: () => `https://macro.com/app/dashboard/${id}`,
	});
	const macro = fakeMacro({
		dashboards: {
			create: async (view: unknown) => {
				created.push(view);
				return handle("d-1");
			},
			byId: handle,
		},
		me: {
			homeDashboard: async () => undefined,
			setHomeDashboard: async (home: { id: string }) => {
				if (failNextHome) {
					failNextHome = false;
					throw new Error("Macro API error 503");
				}
				homes.push(home.id);
			},
		},
	});
	const fake = context(macro);

	await expect(ensureHomeDashboard(fake)).rejects.toThrow("503");
	expect(await ensureHomeDashboard(fake)).toEqual({ kind: "created" });
	expect(created).toHaveLength(1);
	expect(homes).toEqual(["d-1"]);
	expect(await ensureHomeDashboard(fake)).toEqual({ kind: "existing" });
});

test("a pending dashboard deleted since is replaced by a new default", async () => {
	const created: unknown[] = [];
	const homes: string[] = [];
	const handle = (id: string) => ({
		id,
		webUrl: () => `https://macro.com/app/dashboard/${id}`,
	});
	const macro = fakeMacro({
		dashboards: {
			create: async (view: unknown) => {
				created.push(view);
				return handle("d-2");
			},
			byId: handle,
		},
		me: {
			homeDashboard: async () => undefined,
			setHomeDashboard: async (home: { id: string }) => {
				if (home.id === "gone") {
					throw Object.assign(new Error("Macro API error 404"), {
						status: 404,
					});
				}
				homes.push(home.id);
			},
		},
	});
	const fake = context(macro);
	fake.files.set("/state/memory/dashboard/home-dashboard-pending", "gone\n");

	expect(await ensureHomeDashboard(fake)).toEqual({ kind: "created" });
	expect(created).toHaveLength(1);
	expect(homes).toEqual(["d-2"]);
});

test("an agent that already has a home dashboard keeps it", async () => {
	const macro = fakeMacro({
		dashboards: {
			create: async () => {
				throw new Error("must not create");
			},
		},
		me: { homeDashboard: async () => ({ id: "mine" }) },
	});

	expect(await ensureHomeDashboard(context(macro))).toEqual({
		kind: "existing",
	});
});

test("while dashboards are off for the account, nothing is written and a later run tries again", async () => {
	const macro = fakeMacro({
		dashboards: {
			create: async () => {
				throw Object.assign(new Error("Macro API error 404"), { status: 404 });
			},
		},
		me: { homeDashboard: async () => undefined },
	});
	const fake = context(macro);

	expect(await ensureHomeDashboard(fake)).toEqual({ kind: "unavailable" });
	expect(fake.files.size).toBe(0);
	expect(fake.events).toEqual([{ kind: "unavailable" }]);
});

test("every pane of the default dashboard has an id, so it can be patched", () => {
	const ids = JSON.stringify(defaultDashboard(agentId)).match(/"id":"[^"]+"/g);
	expect(ids).toEqual([
		'"id":"about"',
		'"id":"work"',
		'"id":"open-tasks"',
		'"id":"documents"',
	]);
});
