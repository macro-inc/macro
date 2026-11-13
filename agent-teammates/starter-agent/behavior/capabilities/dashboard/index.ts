/**
 * Dashboard: the agent's home dashboard in Macro, the page people open to see
 * what it is doing. A new agent gets a default one on its first run; after
 * that it changes its own dashboard through the SDK (`macro.dashboards`).
 */
import type { Dashboard, DashboardView, Macro } from "@macro-inc/sdk";
import { behavior } from "@muppet/lib/core/behavior";
import { module } from "@muppet/lib/core/capability";
import type { Base } from "../../context/index.ts";

/** The state directory the dashboard marker lives in. */
export const owner = "dashboard";
/** Written once the home dashboard exists, so a restart doesn't make another. */
const createdFile = "home-dashboard";
/**
 * The id of the default dashboard, written as soon as it is created and
 * before it becomes the home, so a run that fails in between reuses it next
 * time instead of leaving it orphaned and making another.
 */
const pendingFile = "home-dashboard-pending";

/** The little of the context the dashboard needs, so a test can give it a fake. */
export type Needs = {
	readonly state: Pick<Base["state"], "memory">;
	readonly disk: Pick<Base["disk"], "read" | "write" | "exists">;
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

/** Macro's answer for a dashboard whose current view it cannot read. */
const unreadable = 422;

/**
 * Whether the agent has a home dashboard. One whose current view Macro cannot
 * read (it answers 422) still exists, so it is `"unreadable"`, not `"none"`.
 */
const home = async (
	macro: Awaited<ReturnType<Needs["macro"]>>,
): Promise<"none" | "readable" | "unreadable"> => {
	try {
		return (await macro.me.homeDashboard()) === undefined
			? "none"
			: "readable";
	} catch (error) {
		if (status(error) === unreadable) return "unreadable";
		throw error;
	}
};

/** What making the home dashboard came to. */
export type Ensured =
	| { readonly kind: "created" | "existing" }
	| { readonly kind: "unavailable" | "unreadable" };

/**
 * Makes the dashboard recorded as pending the home, when one is recorded and
 * still exists; `undefined` when there is none to reuse.
 */
const reusePending = async (
	context: Needs,
	macro: Awaited<ReturnType<Needs["macro"]>>,
	pending: string,
): Promise<Dashboard | undefined> => {
	const id = (await context.disk.read(pending))?.trim();
	if (!id) return undefined;
	const dashboard = macro.dashboards.byId(id);
	try {
		await macro.me.setHomeDashboard(dashboard);
		return dashboard;
	} catch (error) {
		// Deleted since, or dashboards are off: creating answers which.
		if (status(error) === notFound) return undefined;
		throw error;
	}
};

/**
 * Makes sure the agent has a home dashboard: once, on its first run, it
 * creates the default and makes it its home. An agent that already has one
 * keeps it. One whose current view Macro cannot read (the server answers 422)
 * is kept too: the run logs it and writes nothing, so a later run checks again
 * after the agent saves a new view or sets another home. While dashboards are
 * off for the agent's account (the server answers 404), nothing is written,
 * so a later run tries again. A default created by a run that failed before
 * making it the home is reused.
 */
export const ensureHomeDashboard = async (context: Needs): Promise<Ensured> => {
	const memory = context.state.memory(owner);
	const marker = context.join(memory, createdFile);
	if (await context.disk.exists(marker)) return { kind: "existing" };
	const pending = context.join(memory, pendingFile);
	const macro = await context.macro();
	try {
		const found = await home(macro);
		if (found === "unreadable") {
			await context.log.event(owner, { kind: "unreadable" });
			return { kind: "unreadable" };
		}
		if (found === "none") {
			let dashboard = await reusePending(context, macro, pending);
			if (dashboard === undefined) {
				const me = await macro.users.me();
				dashboard = await macro.dashboards.create(defaultDashboard(me.id));
				await context.disk.write(pending, `${dashboard.id}\n`);
				await macro.me.setHomeDashboard(dashboard);
			}
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
