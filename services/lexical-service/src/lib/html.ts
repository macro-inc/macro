/**
 * Markdown to the HTML an email body carries, rendered headless.
 *
 * The composer produces its HTML by exporting a live Lexical editor, so a
 * caller with no composer — the `SendEmail` AI tool, whose body the model
 * writes as markdown — has to export the same way or the two paths drift.
 *
 * Lexical's own `withDOM` cannot do it here. Workers resolve the browser
 * build, which only asserts a global `window`, and the node build reaches for
 * happy-dom, which needs `vm.Script.runInContext` that workerd does not
 * implement. linkedom is the DOM that runs on workerd, so the shim below is
 * ours.
 */

import { createHeadlessEditor } from "@lexical/headless";
import { $generateHtmlFromNodes } from "@lexical/html";
import { $convertFromMarkdownString } from "@lexical/markdown";
import {
	NodeReplacements,
	SupportedNodeTypes,
} from "@macro-inc/lexical-core/node-list";
import { ALL_TRANSFORMERS } from "@macro-inc/lexical-core/transformers";
import { $getRoot } from "lexical";
import { parseHTML } from "linkedom";

/** An email body in both parts a MIME message wants. */
export type RenderedBody = {
	/** The HTML body, as the composer would have exported it. */
	html: string;
	/** The plain-text alternative, for clients that ask for one. */
	text: string;
};

/**
 * Runs `f` with a linkedom document installed as the global DOM. Synchronous
 * on purpose: the globals are torn down when it returns, so nothing may await
 * inside.
 */
function withDOM<T>(f: () => T): T {
	const { window, document, DOMParser, MutationObserver } = parseHTML(
		"<!doctype html><html><body></body></html>",
	);
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		DOMParser: globalThis.DOMParser,
		MutationObserver: globalThis.MutationObserver,
	};
	Object.assign(globalThis, { window, document, DOMParser, MutationObserver });
	try {
		return f();
	} finally {
		Object.assign(globalThis, previous);
	}
}

/**
 * Parses `markdown` with the app's nodes and transformers, then exports the
 * result as HTML and as plain text.
 */
export function markdownToHtml(markdown: string): RenderedBody {
	const editor = createHeadlessEditor({
		nodes: [...SupportedNodeTypes, ...NodeReplacements],
		onError: (error) => {
			throw error;
		},
	});

	editor.update(() => $convertFromMarkdownString(markdown, ALL_TRANSFORMERS), {
		discrete: true,
	});

	const html = withDOM(() => editor.read(() => $generateHtmlFromNodes(editor)));
	const text = editor.read(() => $getRoot().getTextContent());

	return { html, text };
}
