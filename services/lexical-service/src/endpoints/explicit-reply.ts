import { isExplicitReplyMarkdown } from "@macro-inc/lexical-core/utils/explicit-reply";
import { OpenAPIRoute } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";
import { handleEndpointError } from "../lib/error-handler";
import { standardErrorResponses } from "../lib/schemas";

const explicitReplyRequest = z.object({
	markdown: z.string(),
});

const explicitReplyResponse = z.object({
	isExplicitReply: z.boolean(),
});

export class ExplicitReplyEndpoint extends OpenAPIRoute {
	schema = {
		summary: "Detect whether Markdown is an explicit reply",
		description:
			"Reports whether Macro Markdown begins with a ReplyTarget node followed by authored content. Standard blockquotes do not count as replies.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: explicitReplyRequest,
					},
				},
			},
		},
		responses: {
			200: {
				description: "Successfully evaluated the markdown",
				content: {
					"application/json": {
						schema: explicitReplyResponse,
					},
				},
			},
			...standardErrorResponses,
		},
	};

	async handle(c: Context) {
		try {
			const { body } = await this.getValidatedData<typeof this.schema>();
			return c.json({
				isExplicitReply: isExplicitReplyMarkdown(body.markdown),
			});
		} catch (error) {
			return handleEndpointError(error, c);
		}
	}
}
