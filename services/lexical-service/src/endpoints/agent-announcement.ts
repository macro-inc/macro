import {
	MAGIC_CHIP_AUTHORS,
	MAGIC_CHIP_STATUSES,
} from "@macro-inc/lexical-core/nodes/MagicChipNode";
import { composeAgentSessionAnnouncement } from "@macro-inc/lexical-core/utils/agent-announcement";
import { OpenAPIRoute } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";
import { handleEndpointError } from "../lib/error-handler";
import { standardErrorResponses } from "../lib/schemas";

const agentAnnouncementRequest = z.object({
	promptMarkdown: z.string(),
	chip: z.object({
		agentSessionId: z.string(),
		channelId: z.string(),
		promptedMessage: z.object({
			turn: z.number().int().nonnegative(),
			author: z.enum(MAGIC_CHIP_AUTHORS),
		}),
		status: z.enum(MAGIC_CHIP_STATUSES),
	}),
});

const agentAnnouncementResponse = z.object({
	markdown: z.string(),
});

export class AgentAnnouncementEndpoint extends OpenAPIRoute {
	schema = {
		summary: "Compose a agent-harness bot respose",
		description:
			"Builds a response from the agent harness bot. Usually a simple quote + magic chip.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: agentAnnouncementRequest,
					},
				},
			},
		},
		responses: {
			200: {
				description: "Successfully composed the announcement markdown",
				content: {
					"application/json": {
						schema: agentAnnouncementResponse,
					},
				},
			},
			...standardErrorResponses,
		},
	};

	async handle(c: Context) {
		try {
			const { body } = await this.getValidatedData<typeof this.schema>();
			const markdown = composeAgentSessionAnnouncement(body);
			return c.json({ markdown });
		} catch (error) {
			return handleEndpointError(error, c);
		}
	}
}
