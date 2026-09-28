import { OpenAPIRoute } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";
import { handleEndpointError } from "../lib/error-handler";
import { markdownToHtml } from "../lib/html";
import { standardErrorResponses } from "../lib/schemas";

const htmlRequest = z.object({
	markdown: z.string(),
});

const htmlResponse = z.object({
	html: z.string(),
	text: z.string(),
});

export class HtmlEndpoint extends OpenAPIRoute {
	schema = {
		summary: "Convert markdown to an email-ready HTML body",
		description:
			"Parses a markdown string as Lexical editor state using the app's nodes and transformers, then exports it as HTML and plain text — the same conversion the draft composer performs in the browser.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: htmlRequest,
					},
				},
			},
		},
		responses: {
			200: {
				description: "Successfully converted markdown to HTML",
				content: {
					"application/json": {
						schema: htmlResponse,
					},
				},
			},
			...standardErrorResponses,
		},
	};

	async handle(c: Context) {
		try {
			const { body } = await this.getValidatedData<typeof this.schema>();
			return c.json(markdownToHtml(body.markdown));
		} catch (error) {
			return handleEndpointError(error, c);
		}
	}
}
