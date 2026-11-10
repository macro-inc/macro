import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";

const PREFIX = "/@macro-sourcemap/";
const LINKED_RESPONSE = Symbol.for("macro.dev-external-sourcemaps.response");
/** Maps are content-addressed, so this bounds memory, not correctness. */
const MAX_MAPS = 20_000;

/**
 * Serves the dev server's source maps from their own URLs instead of inline.
 * Vite appends every module's map as a base64 data URL, which is ~70% of the
 * bytes a remote browser downloads; browsers fetch a linked map only while
 * DevTools is open. Register after `devCompression` so the slimmer body is
 * what gets compressed.
 */
export function devExternalSourcemaps(
	env: Record<string, string | undefined> = process.env,
): Plugin {
	const maps = new Map<string, Buffer>();

	const middleware: Connect.NextHandleFunction = (req, res, next) => {
		if (req.url?.startsWith(PREFIX)) {
			const map = maps.get(req.url.slice(PREFIX.length));
			if (!map) {
				res.statusCode = 404;
				res.end("Source map expired; reload the module");
				return;
			}
			res.setHeader("Content-Type", "application/json");
			res.setHeader("Cache-Control", "max-age=31536000,immutable");
			res.end(map);
			return;
		}
		if (Reflect.get(res, LINKED_RESPONSE)) return next();
		Reflect.set(res, LINKED_RESPONSE, true);
		linkInlineMaps(res, (map) => {
			const name = `${createHash("sha1").update(map).digest("hex")}.map`;
			maps.delete(name);
			maps.set(name, map);
			if (maps.size > MAX_MAPS) {
				const oldest = maps.keys().next().value;
				if (oldest) maps.delete(oldest);
			}
			return `${PREFIX}${name}`;
		});
		next();
	};

	return {
		name: "macro-dev-external-sourcemaps",
		apply: (_config, { command, isPreview }) =>
			command === "serve" &&
			!isPreview &&
			env.MACRO_DEV_INLINE_SOURCEMAPS !== "true",
		configureServer(server) {
			server.middlewares.use(middleware);
		},
	};
}

function linkInlineMaps(res: ServerResponse, store: (map: Buffer) => string) {
	const end = res.end;
	// One signature, so TypeScript can resolve `call` with just a body.
	const endWith = end as (this: ServerResponse, body: string) => ServerResponse;
	res.end = function (this: ServerResponse, ...args: unknown[]) {
		res.end = end;
		const [body] = args;
		const text =
			typeof body === "string"
				? body
				: Buffer.isBuffer(body)
					? body.toString("utf8")
					: undefined;
		const map = text === undefined ? undefined : inlineMap(text);
		if (!text || !map) return end.apply(this, args as Parameters<typeof end>);
		const url = store(Buffer.from(map.base64, "base64"));
		const linked = `${text.slice(0, map.start)}\n${map.comment}${url}${map.close}`;
		return endWith.call(this, linked);
	} as typeof end;
}

/** Scan only the terminal map comment without a regexp over a multi-MB module. */
function inlineMap(text: string) {
	const js = "\n//# sourceMappingURL=";
	const css = "\n/*# sourceMappingURL=";
	const start = Math.max(text.lastIndexOf(js), text.lastIndexOf(css));
	if (start < 0) return;
	const isCSS = text.startsWith(css, start);
	const marker = isCSS ? css : js;
	let value = text.slice(start + marker.length).trimEnd();
	const close = isCSS ? " */" : "";
	if (isCSS) {
		if (!value.endsWith(close)) return;
		value = value.slice(0, -close.length);
	}
	const prefix = "data:application/json;";
	if (!value.startsWith(prefix)) return;
	value = value.slice(prefix.length);
	if (value.startsWith("charset=utf-8;")) value = value.slice(14);
	if (!value.startsWith("base64,")) return;
	const base64 = value.slice(7);
	if (!base64.length) return;
	for (let index = 0; index < base64.length; index++) {
		const code = base64.charCodeAt(index);
		if (
			!(
				(code >= 65 && code <= 90) ||
				(code >= 97 && code <= 122) ||
				(code >= 48 && code <= 57) ||
				code === 43 ||
				code === 47 ||
				code === 61
			)
		)
			return;
	}
	return { start, comment: marker.slice(1), base64, close };
}
