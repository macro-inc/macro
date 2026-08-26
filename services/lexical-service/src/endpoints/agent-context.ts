import { composeAgentContextPrompt } from "@macro-inc/lexical-core/utils/agent-context";
import { OpenAPIRoute } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";
import { handleEndpointError } from "../lib/error-handler";
import { standardErrorResponses } from "../lib/schemas";

const agentContextRequest = z.object({
	promptMarkdown: z.string(),
	messages: z
		.array(
			z.object({
				sender: z.string(),
				content: z.string(),
			}),
		)
		.optional(),
});

const agentContextResponse = z.object({
	markdown: z.string(),
});

export class AgentContextEndpoint extends OpenAPIRoute {
	schema = {
		summary: "Compose an agent prompt with channel context",
		description:
			"Builds internal markdown containing optional untrusted prior channel messages and the user prompt.",
		request: {
			body: {
				content: {
					"application/json": {
						schema: agentContextRequest,
					},
				},
			},
		},
		responses: {
			200: {
				description: "Successfully composed the agent context markdown",
				content: {
					"application/json": {
						schema: agentContextResponse,
					},
				},
			},
			...standardErrorResponses,
		},
	};

	async handle(c: Context) {
		try {
			const { body } = await this.getValidatedData<typeof this.schema>();
			const markdown = composeAgentContextPrompt(body);
			return c.json({ markdown });
		} catch (error) {
			return handleEndpointError(error, c);
		}
	}
}
