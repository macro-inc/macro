import { describe, expect, test } from "bun:test";
import type { Agent } from "../agent.ts";
import { behavior } from "../behavior.ts";
import { source } from "../event.ts";
import type { Failure } from "../hook.ts";
import type { Runtime } from "../runtime.ts";

async function* nothing(): AsyncIterable<string> {}
async function* numbers(): AsyncIterable<number> {}

const agent: Agent = { wake: async () => ({ kind: "done", reply: "ok" }) };

/** A runtime that runs nothing: these tests are about what compiles. */
const idle: Runtime = { run: async () => undefined };

describe("a name in the context means one thing", () => {
	const named = behavior().decorate({ name: "first", count: 1 });

	test("decorating with a name that is already there doesn't compile", () => {
		// @ts-expect-error "name" is already in the context
		named.decorate({ name: "second" });
		expect(named.decorate({ other: true }).decorations).toEqual({
			name: "first",
			count: 1,
			other: true,
		});
	});

	test("a name another behavior needs, but doesn't have, can be decorated", () => {
		const needing = behavior<{ readonly name: string }>();
		expect(needing.decorate({ name: "given" }).decorations.name).toBe("given");
	});

	test("using a behavior with something different under the same name doesn't compile, and throws", () => {
		const other = behavior().decorate({ name: () => "a function" });
		// @ts-expect-error "name" is something different in each behavior
		expect(() => named.use(other)).toThrow('"name" in the context');
	});

	test("the same behavior may be used more than once", () => {
		const first = behavior().use(named).decorate({ one: 1 });
		const second = behavior().use(named).decorate({ two: 2 });
		expect(behavior().use(named).use(first).use(second).decorations).toEqual({
			name: "first",
			count: 1,
			one: 1,
			two: 2,
		});
	});

	test("two values of one type under the same name compile, but throw: one would replace the other", () => {
		const made = () =>
			behavior().decorate({ queue: new Map<string, string>() });
		expect(() => made().use(made())).toThrow('"queue" in the context');
	});
});

describe("a source's name means one source", () => {
	const mailed = behavior().source({ mail: source(nothing()) });

	test("registering a name that is already a source doesn't compile", () => {
		// @ts-expect-error "mail" is already in the sources
		mailed.source({ mail: source(nothing()) });
	});

	test("hooks is the lifecycle's name", () => {
		// @ts-expect-error "hooks" is already in the sources
		behavior().source({ hooks: source(nothing()) });
	});

	test("using a behavior with a different source by the same name doesn't compile, and throws", () => {
		const other = behavior().source({ mail: source(numbers()) });
		// @ts-expect-error "mail" is something different in each behavior
		expect(() => mailed.use(other)).toThrow('the source "mail"');
	});

	test("the same sources may be used by several behaviors", () => {
		const handlers = behavior()
			.use(mailed)
			.on(
				(sources) => sources.mail,
				async () => undefined,
			);
		expect(Object.keys(behavior().use(mailed).use(handlers).sources)).toEqual([
			"mail",
		]);
	});
});

describe("a behavior only runs once failures are handled", () => {
	const seen: Failure["kind"][] = [];
	const watching = behavior().on(
		(sources) => sources.hooks.failed,
		async (failure) => {
			seen.push(failure.kind);
		},
	);

	test("without a handler on hooks.failed, run doesn't compile", async () => {
		const unwatched = behavior().decorate({ agent });
		// @ts-expect-error failures are not handled: subscribe a handler to hooks.failed
		await unwatched.run(idle);
		// @ts-expect-error a runtime doesn't take it either
		await idle.run(unwatched);
	});

	test("a handler on another hook isn't a handler of failures", async () => {
		const other = behavior()
			.decorate({ agent })
			.on(
				(sources) => sources.hooks.postReply,
				async () => undefined,
			);
		// @ts-expect-error failures are not handled: subscribe a handler to hooks.failed
		await other.run(idle);
	});

	test("with one, it runs, wherever the handler was subscribed", async () => {
		await watching.decorate({ agent }).run(idle);
		await behavior().decorate({ agent }).use(watching).run(idle);
		await behavior()
			.use(watching)
			.use(behavior().decorate({ agent }))
			.run(idle);
		expect(seen).toEqual([]);
	});
});
