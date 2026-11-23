import type { Agent, EventContext, Woke } from "./agent.ts";
import type { Capability, Catalog } from "./capability.ts";
import { describeError } from "./error.ts";
import type { Source } from "./event.ts";
import type { Failure, Hooks, Lifecycle } from "./hook.ts";
import type { Runtime } from "./runtime.ts";

/**
 * An agent's behavior, built by chaining, like an Elysia app. `decorate`
 * adds to the context, `source` registers event sources, `capability`
 * lists capabilities in the agent's catalog, and `on` subscribes a handler to a
 * registered source. Everything registered later sees, typed, what was added before it.
 *
 * Behaviors compose with `use`, so sources, capabilities and handlers can
 * live in separate files. A behavior can declare dependencies it needs
 * without providing them, `behavior<{ model: Model }>()`, and `serve` only
 * accepts a behavior once `decorate` has provided every need.
 *
 * A name in the context, or among the sources, means one thing. Adding a
 * name that is already there doesn't compile, and neither does using a
 * behavior that has something different under a name this one has: the
 * later one would silently replace the earlier, and whatever read the
 * earlier would get the wrong thing. The same behavior may be used more than
 * once, since what it brings is the same each time.
 */
export type Behavior<
	Needs,
	Provided,
	Sources,
	Failures = FailuresUnhandled,
> = State<Needs, Provided, Sources> & {
	/** Never set: it only carries, in its type, whether a handler is subscribed to `hooks.failed`. */
	readonly failures?: Failures;

	/** Adds to the context. A name that is already in it doesn't compile. */
	readonly decorate: <
		Extra extends object & Unclaimed<Provided, Extra, "the context">,
	>(
		extra: Extra,
	) => Behavior<Needs, Provided & Extra, Sources, Failures>;

	/**
	 * Adds everything another behavior has. Doesn't compile if the two have
	 * something different under one name, in the context or among the sources.
	 */
	readonly use: <N, P, S, F>(
		other: Behavior<N, P, S, F> &
			Agreeing<"decorations", Provided, P> &
			Agreeing<"sources", Sources, S>,
	) => Behavior<
		Needs & N,
		Provided & P,
		Sources & S,
		HandledByEither<Failures, F>
	>;

	/** Registers event sources. A name that is already a source, or `hooks`, doesn't compile. */
	readonly source: <
		Extra extends Readonly<Record<string, Source<unknown>>> &
			Unclaimed<WithHooks<Sources>, Extra, "the sources">,
	>(
		extra: Extra,
	) => Behavior<Needs, Provided, Sources & Extra, Failures>;

	/**
	 * Lists a capability in the agent's catalog: a `module` of its own
	 * functions, or an `npm` package or flake `program`.
	 */
	readonly capability: (
		capability: Capability,
	) => Behavior<Needs, Provided, Sources, Failures>;

	/**
	 * Subscribes a handler to a registered source, or to a lifecycle hook
	 * under `hooks`. A handler on `hooks.failed` is what lets the behavior run.
	 */
	readonly on: <Payload>(
		select: (sources: WithHooks<Sources>) => Source<Payload>,
		handle: Handle<Needs & Provided, Payload>,
	) => Behavior<
		Needs,
		Provided,
		Sources,
		[Payload] extends [Failure]
			? [Failure] extends [Payload]
				? FailuresHandled
				: Failures
			: Failures
	>;

	/**
	 * Runs this behavior on `runtime`. Only compiles once `decorate` has
	 * provided every need, and an `agent` for handlers to wake, and a handler
	 * is subscribed to `hooks.failed`, so that nothing fails unseen.
	 */
	readonly run: <P extends Needs & { readonly agent: Agent }>(
		this: Behavior<Needs, P, Sources, FailuresHandled>,
		runtime: Runtime,
	) => Promise<void>;
};

/** A behavior with no handler on `hooks.failed`. It reads as the error when one is run. */
export type FailuresUnhandled =
	"failures are not handled: subscribe a handler to hooks.failed";

/** A behavior with a handler on `hooks.failed`. */
export type FailuresHandled = "failures are handled";

/** Handled if either behavior handles failures. */
type HandledByEither<Mine, Theirs> = [Mine] extends [FailuresHandled]
	? FailuresHandled
	: [Theirs] extends [FailuresHandled]
		? FailuresHandled
		: FailuresUnhandled;

/**
 * Nothing, unless `Extra` has a name `Have` already has: then that name must
 * be the message saying so, which no value is, so the call doesn't compile.
 */
type Unclaimed<Have, Extra, Where extends string> = {
	readonly [Name in keyof Extra &
		keyof Have]: `"${Name & string}" is already in ${Where}`;
};

/** Whether two types are the same, each assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** The names two records both have, with different types. */
type Differing<Mine, Theirs> = {
	[Name in keyof Mine & keyof Theirs]: Same<
		Mine[Name],
		Theirs[Name]
	> extends true
		? never
		: Name;
}[keyof Mine & keyof Theirs];

/**
 * Nothing, unless the behavior being used has something different under a
 * name this one has, in `Field`: then that name must be the message saying
 * so, and the call doesn't compile.
 */
type Agreeing<Field extends string, Mine, Theirs> = [
	Differing<Mine, Theirs>,
] extends [never]
	? unknown
	: {
			readonly [Key in Field]: {
				readonly [Name in Differing<
					Mine,
					Theirs
				>]: `"${Name & string}" is something different in each behavior`;
			};
		};

/** The context a behavior gives its handlers and capabilities. */
export type ContextOf<B> =
	B extends Behavior<
		infer Needs,
		infer Provided,
		infer _Sources,
		infer _Failures
	>
		? Needs & Provided
		: never;

/** Every behavior's sources include the lifecycle hooks, which the runtime fires. */
export type WithHooks<Sources> = Sources & { readonly hooks: Hooks };

/** Wakes the agent with a request about the event being handled, and returns its reply. */
export type Wake = (request: string) => Promise<Woke>;

/** Receives the event's payload from the source, and the context, with `wake`. */
export type Handle<Context, Payload> = (
	payload: Payload,
	context: Context & { readonly wake: Wake },
) => Promise<void>;

type State<Needs, Provided, Sources> = {
	readonly decorations: Provided;
	readonly sources: Sources;
	readonly capabilities: Catalog;
	readonly handlers: readonly Subscription<Needs & Provided, Sources>[];
};

/** What happened when a handler handled an event: it finished, or threw. */
export type Handled =
	| { readonly kind: "handled" }
	| { readonly kind: "failed"; readonly error: string };

/** An event as the runtime sees it: where it came from, and what it carried. */
export type Event = EventContext & { readonly source: Source<unknown> };

/** Receives what happened when a handler handled an event. */
export type Accept = (handled: Handled, event: Event) => Promise<void>;

/** How the runtime wakes the agent when a handler asks, for the event it was handling. */
export type WakeFor = (request: string, event: Event) => Promise<Woke>;

/**
 * Decides when the handling of one event runs: a handler's call for the
 * event, then `accept`. It must call `handling` exactly once. Its source
 * moves to the next event when the promise it returns resolves, which may be
 * before the handling has finished: `inTurn` waits for it, a runtime that
 * handles a source's events at the same time doesn't.
 */
export type Schedule = (
	handling: () => Promise<void>,
	event: Event,
) => Promise<void>;

/** Handles a source's events one at a time: the next waits for this one. */
export const inTurn: Schedule = (handling) => handling();

/** Starts a handler. Its source is chosen only now, so hooks can be made per run. */
type Subscription<Context, Sources> = (
	context: Context,
	sources: WithHooks<Sources>,
	wakeFor: (source: Source<unknown>, payload: unknown) => Wake,
	accept: (
		handled: Handled,
		source: Source<unknown>,
		payload: unknown,
	) => Promise<void>,
	schedule: (
		handling: () => Promise<void>,
		source: Source<unknown>,
		payload: unknown,
	) => Promise<void>,
) => { readonly source: Source<unknown>; readonly done: Promise<void> };

/**
 * The names both records have, with a different value under each. Types
 * can't catch this when the two values have the same type, e.g. a context
 * made twice.
 */
const clashing = <Mine, Theirs>(
	mine: Mine,
	theirs: Theirs,
): readonly string[] => {
	const had = new Map<string, unknown>(Object.entries({ ...mine, ...{} }));
	return Object.entries({ ...theirs, ...{} }).flatMap(([name, value]) =>
		had.has(name) && had.get(name) !== value ? [name] : [],
	);
};

const make = <Needs, Provided, Sources, Failures>(
	state: State<Needs, Provided, Sources>,
): Behavior<Needs, Provided, Sources, Failures> => ({
	...state,

	decorate: (extra) =>
		make({ ...state, decorations: { ...state.decorations, ...extra } }),

	use: <N, P, S, F>(other: Behavior<N, P, S, F>) => {
		const clashes = [
			...clashing(state.decorations, other.decorations).map(
				(name) => `"${name}" in the context`,
			),
			...clashing(state.sources, other.sources).map(
				(name) => `the source "${name}"`,
			),
		];
		if (clashes.length > 0)
			throw new Error(
				`two behaviors each have their own ${clashes.join(", and ")}: one would replace the other`,
			);
		// A behavior used twice, e.g. shared capabilities, must not subscribe twice.
		const existing: readonly unknown[] = state.handlers;
		const handlers: readonly Subscription<
			Needs & N & Provided & P,
			Sources & S
		>[] = [
			...state.handlers,
			...other.handlers.filter((handler) => !existing.includes(handler)),
		];
		const capabilities: Catalog = {
			...state.capabilities,
			...other.capabilities,
		};
		return make<
			Needs & N,
			Provided & P,
			Sources & S,
			HandledByEither<Failures, F>
		>({
			decorations: { ...state.decorations, ...other.decorations },
			sources: { ...state.sources, ...other.sources },
			capabilities,
			handlers,
		});
	},

	source: (extra) =>
		make({ ...state, sources: { ...state.sources, ...extra } }),

	capability: (capability) =>
		make({
			...state,
			capabilities: { ...state.capabilities, [capability.name]: capability },
		}),

	on: (select, handle) => {
		const subscription: Subscription<Needs & Provided, Sources> = (
			context,
			sources,
			wakeFor,
			accept,
			schedule,
		) => {
			const source = select(sources);
			const done = (async () => {
				for await (const payload of source)
					await schedule(
						async () => {
							// try, not .then: a handler that isn't async can throw before it returns a promise.
							const handled = await (async (): Promise<Handled> => {
								try {
									await handle(payload, {
										...context,
										wake: wakeFor(source, payload),
									});
									return { kind: "handled" };
								} catch (error) {
									return { kind: "failed", error: describeError(error) };
								}
							})();
							await accept(handled, source, payload);
						},
						source,
						payload,
					);
			})();
			return { source, done };
		};
		return make({ ...state, handlers: [...state.handlers, subscription] });
	},

	run(runtime) {
		return runtime.run(this);
	},
});

export const behavior = <Needs extends object = {}>(): Behavior<
	Needs,
	{},
	{},
	FailuresUnhandled
> => make({ decorations: {}, sources: {}, capabilities: {}, handlers: [] });

/**
 * The handlings that were scheduled and haven't finished. A source can end
 * before they have, when its schedule doesn't wait for them. `failed`
 * rejects with the error of the first handling that rejects, which no
 * schedule has to pass on.
 */
const unfinished = (): {
	readonly track: (handling: () => Promise<void>) => () => Promise<void>;
	readonly finished: () => Promise<void>;
	readonly failed: Promise<never>;
} => {
	const pending = new Set<Promise<void>>();
	let fail: (error: unknown) => void = () => undefined;
	const failed = new Promise<never>((_, reject) => {
		fail = reject;
	});
	const finished = async (): Promise<void> => {
		if (pending.size === 0) return;
		await Promise.all(pending);
		await finished();
	};
	return {
		track: (handling) => {
			let settle: (result: Promise<void>) => void = () => undefined;
			const settled = new Promise<void>((resolve) => {
				settle = resolve;
			}).catch(fail);
			pending.add(settled);
			void settled.then(() => pending.delete(settled));
			return () => {
				const result = handling();
				settle(result);
				return result;
			};
		},
		finished,
		failed,
	};
};

/**
 * Runs every handler until its source ends. A handler's `wake` goes to
 * `wakeFor` with the event it is handling. `accept` receives what happened,
 * including any error a handler threw, which doesn't end its source.
 * `schedule` decides when each handling runs; without one a source moves to
 * its next event once every handler on it has returned and `accept` has
 * resolved. Once every other source has ended and every handling has
 * finished, the hooks are closed so their handlers end too. Rejects as soon
 * as a handling does, i.e. when `accept` rejects.
 */
export const serve = async <Needs, Provided extends Needs, Sources>(
	behavior: Behavior<Needs, Provided, Sources, FailuresHandled>,
	lifecycle: Lifecycle,
	{
		wakeFor,
		accept,
		schedule = inTurn,
	}: {
		readonly wakeFor: WakeFor;
		readonly accept: Accept;
		readonly schedule?: Schedule;
	},
): Promise<void> => {
	const running = unfinished();
	const sources = { ...behavior.sources, hooks: lifecycle.hooks };
	const names = new Map<unknown, string>([
		...Object.entries(sources).map(([name, source]) => [source, name] as const),
		...Object.entries(lifecycle.hooks).map(
			([name, source]) => [source, `hooks.${name}`] as const,
		),
	]);
	const event = (source: Source<unknown>, payload: unknown): Event => ({
		name: names.get(source) ?? "unknown",
		payload,
		source,
	});
	const hooks: readonly unknown[] = Object.values(lifecycle.hooks);
	const started = behavior.handlers.map((subscription) =>
		subscription(
			behavior.decorations,
			sources,
			(source, payload) => (request) =>
				wakeFor(request, event(source, payload)),
			(handled, source, payload) => accept(handled, event(source, payload)),
			(handling, source, payload) =>
				schedule(
					// A hook's handling is waited for by whatever fired the hook.
					hooks.includes(source) ? handling : running.track(handling),
					event(source, payload),
				),
		),
	);
	const ended = (async () => {
		await Promise.all(
			started
				.filter(({ source }) => !hooks.includes(source))
				.map(({ done }) => done),
		);
		// A schedule may have let a source end while its events are still being handled, and they fire hooks.
		await running.finished();
	})();
	await Promise.race([ended, running.failed]);
	lifecycle.close();
	await Promise.all(started.map(({ done }) => done));
};
