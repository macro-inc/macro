import { extractExplicitReply } from "@macro-inc/lexical-core/utils/explicit-reply";
import { OpenAPIRoute } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";
import { handleEndpointError } from "../lib/error-handler";
import { standardErrorResponses } from "../lib/schemas";

const extractReplyRequest = z.object({
	markdown: z.string(),
});

const replyTarget = z.object({
	channelId: z.string(),
	targetMessageId: z.string(),
	targetThreadId: z.string(),
	displayText: z.string(),
	senderId: z.string(),
});

const extractReplyResponse = z.object({
	reply: replyTarget.nullable(),
});

export class ExtractReplyEndpoint extends OpenAPIRoute {
	schema = {
		summary: "Extract an explicit reply target from Markdown",
		description:
			"Parses Macro Markdown and returns the leading ReplyTarget node when it is followed by authored content. Standard blockquotes do not count as replies.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: extractReplyRequest,
					},
				},
			},
		},
		responses: {
			200: {
				description: "Successfully evaluated the markdown",
				content: {
					"application/json": {
						schema: extractReplyResponse,
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
				reply: extractExplicitReply(body.markdown),
			});
		} catch (error) {
			return handleEndpointError(error, c);
		}
	}
}
