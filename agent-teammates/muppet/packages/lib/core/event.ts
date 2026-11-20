const isSource = Symbol("isSource");

/**
 * A stream of events that many handlers can read while it is only started
 * once. Build one with `source`. Every reader sees every event, and the
 * underlying stream is pulled again only after every reader has asked for the
 * next event, i.e. has finished with this one.
 */
export type Source<Payload> = AsyncIterable<Payload> & {
	readonly [isSource]: true;
};

export const source = <Payload>(
	stream: AsyncIterable<Payload>,
): Source<Payload> => {
	let iterator: AsyncIterator<Payload> | undefined;
	let pulling = false;
	const readers = new Set<symbol>();
	const waiting = new Map<
		symbol,
		{
			readonly resolve: (result: IteratorResult<Payload>) => void;
			readonly reject: (error: unknown) => void;
		}
	>();

	const pull = async (): Promise<void> => {
		if (pulling || waiting.size === 0 || waiting.size < readers.size) return;
		pulling = true;
		const round = [...waiting.values()];
		waiting.clear();
		try {
			iterator ??= stream[Symbol.asyncIterator]();
			const result = await iterator.next();
			for (const reader of round) reader.resolve(result);
		} catch (error) {
			for (const reader of round) reader.reject(error);
		} finally {
			pulling = false;
		}
		await pull();
	};

	// Deferred so readers that start together all join before the first pull.
	const schedule = (): void => {
		queueMicrotask(() => void pull());
	};

	return {
		[isSource]: true,
		[Symbol.asyncIterator]: () => {
			const reader = Symbol();
			readers.add(reader);
			return {
				next: () =>
					new Promise<IteratorResult<Payload>>((resolve, reject) => {
						waiting.set(reader, { resolve, reject });
						schedule();
					}),
				return: async () => {
					readers.delete(reader);
					waiting.delete(reader);
					schedule();
					return { done: true, value: undefined };
				},
			};
		},
	};
};

/**
 * A source whose events are pushed in, e.g. lifecycle hooks. `push` resolves
 * once every handler on the source has finished the event, or at once if
 * nothing is listening. After `close`, the source ends once its queued events
 * are delivered.
 */
export const channel = <Payload>(): {
	readonly source: Source<Payload>;
	readonly push: (payload: Payload) => Promise<void>;
	readonly close: () => void;
} => {
	let reading = false;
	let closed = false;
	const queued: { readonly payload: Payload; readonly done: () => void }[] = [];
	/** Finishes the last delivered event; called when the next one is asked for. */
	let finish: (() => void) | undefined;
	let wanting: ((result: IteratorResult<Payload>) => void) | undefined;

	const deliver = (): void => {
		const want = wanting;
		if (want === undefined) return;
		const next = queued.shift();
		if (next !== undefined) {
			wanting = undefined;
			finish = next.done;
			want({ done: false, value: next.payload });
		} else if (closed) {
			wanting = undefined;
			want({ done: true, value: undefined });
		}
	};

	return {
		source: source({
			[Symbol.asyncIterator]: () => {
				reading = true;
				return {
					next: () =>
						new Promise<IteratorResult<Payload>>((resolve) => {
							finish?.();
							finish = undefined;
							wanting = resolve;
							deliver();
						}),
				};
			},
		}),
		push: (payload) =>
			reading && !closed
				? new Promise<void>((done) => {
						queued.push({ payload, done });
						deliver();
					})
				: Promise.resolve(),
		close: () => {
			closed = true;
			deliver();
		},
	};
};
