/**
 * Dashboard: the agent's home dashboard in Macro, the page people open to see
 * what it is doing. A new agent gets a default one on its first run; after
 * that it changes its own dashboard through the SDK (`macro.dashboards`).
 */
import type { DashboardView, Macro } from "@macro-inc/sdk";
import { behavior } from "@muppet/lib/core/behavior";
import { module } from "@muppet/lib/core/capability";
import type { Base } from "../../context/index.ts";

/** The state directory the dashboard marker lives in. */
export const owner = "dashboard";
/** Written once the home dashboard exists, so a restart doesn't make another. */
const createdFile = "home-dashboard";

/** The little of the context the dashboard needs, so a test can give it a fake. */
export type Needs = {
	readonly state: Pick<Base["state"], "memory">;
	readonly disk: Pick<Base["disk"], "write" | "exists">;
	readonly join: Base["join"];
	readonly log: Pick<Base["log"], "event">;
	readonly macro: () => Promise<Pick<Macro, "dashboards" | "me" | "users">>;
};

/**
 * The dashboard a new agent starts with: what it made, read live as
 * whoever opens it. Every pane has an id, so `dashboard.patch(id, widget)`
 * changes one without rewriting the rest.
 */
export const defaultDashboard = (agentId: string): DashboardView => ({
	title: "Dashboard",
	widgets: [
		{
			type: "md",
			id: "about",
			markdown:
				"What I'm working on. Ask me to change this dashboard: add a pane, remove one, or show something else.",
		},
		{
			type: "container",
			id: "work",
			direction: "row",
			wrap: true,
			children: [
				{
					type: "list",
					id: "open-tasks",
					title: "Open tasks I made",
					source: {
						kind: "query",
						query: {
							include: { documentOwnerId: [agentId], subType: ["task"] },
							documentWhere: [
								{ op: "not", clause: { include: { documentDone: true } } },
							],
						},
					},
					limit: 10,
				},
				{
					type: "list",
					id: "documents",
					title: "Documents I made",
					source: {
						kind: "query",
						query: {
							include: { documentOwnerId: [agentId] },
							exclude: { subType: ["task"] },
						},
					},
					groupBy: "date",
					limit: 10,
				},
			],
		},
	],
});

/** Macro's answer while dashboards are off for the account. */
const notFound = 404;

/** The HTTP status a Macro API error carries, if it is one. */
const status = (error: unknown): unknown =>
	typeof error === "object" && error !== null && "status" in error
		? error.status
		: undefined;

/** What making the home dashboard came to. */
export type Ensured =
	| { readonly kind: "created" | "existing" }
	| { readonly kind: "unavailable" };

/**
 * Makes sure the agent has a home dashboard: once, on its first run, it
 * creates the default and makes it its home. An agent that already has one
 * keeps it. While dashboards are off for the agent's account (the server
 * answers 404), nothing is written, so a later run tries again.
 */
export const ensureHomeDashboard = async (context: Needs): Promise<Ensured> => {
	const marker = context.join(context.state.memory(owner), createdFile);
	if (await context.disk.exists(marker)) return { kind: "existing" };
	const macro = await context.macro();
	try {
		if ((await macro.me.homeDashboard()) === undefined) {
			const me = await macro.users.me();
			const dashboard = await macro.dashboards.create(defaultDashboard(me.id));
			await macro.me.setHomeDashboard(dashboard);
			await context.disk.write(marker, `${dashboard.webUrl()}\n`);
			return { kind: "created" };
		}
	} catch (error) {
		if (status(error) === notFound) {
			await context.log.event(owner, { kind: "unavailable" });
			return { kind: "unavailable" };
		}
		throw error;
	}
	await context.disk.write(marker, "existing\n");
	return { kind: "existing" };
};

export const dashboardModule = module({
	name: "dashboard",
	summary:
		"Your home dashboard in Macro: made once on your first run; change it with macro.dashboards in a script.",
	file: import.meta.path,
	functions: { ensureHomeDashboard },
});

export const dashboardCapabilities = behavior<Base>().capability(
	dashboardModule,
);
