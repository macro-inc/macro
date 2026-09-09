import { describe, expect, it } from "bun:test";
import { markdownToHtml } from "./html";

describe("markdownToHtml", () => {
	it("exports block structure the way the composer does", () => {
		const { html } = markdownToHtml("# Title\n\nSome **bold** text.\n");

		expect(html).toContain("<h1>");
		expect(html).toContain("<strong");
		expect(html).toContain("Title");
	});

	it("keeps link hrefs", () => {
		const { html } = markdownToHtml("A [runbook](https://macro.com/runbook).");

		expect(html).toContain('href="https://macro.com/runbook"');
	});

	it("renders tables through the app transformers", () => {
		const { html } = markdownToHtml("| a | b |\n| - | - |\n| 1 | 2 |\n");

		expect(html).toContain("<table>");
		expect(html).not.toContain("| a | b |");
	});

	it("returns a plain-text alternative alongside the html", () => {
		const { text } = markdownToHtml("# Title\n\nSome **bold** text.\n");

		expect(text).toContain("Title");
		expect(text).not.toContain("**");
	});

	it("restores the globals the DOM shim installs", () => {
		const before = globalThis.document;

		markdownToHtml("hello");

		expect(globalThis.document).toBe(before);
	});
});
