import type {
  DecisionRequest,
  DecisionResponse,
  StructuredCompletionRequest,
  StructuredCompletionResponse,
  UsageRequest,
} from '../../../generated/cognition/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { User } from '../users/user';

export type {
  DecisionRequest,
  DecisionResponse,
  StructuredCompletionRequest,
  StructuredCompletionResponse,
};

/** Shared cognition endpoints, charged to the authenticated acting user. */
export class AiNamespace {
  /** Read AI usage over a time range, optionally restricting it to users. */
  async usage(
    options: Omit<UsageRequest, 'include_users'> & { users?: User[] } = {},
  ) {
    const { users, ...rest } = options;
    return unwrap(
      await this.client.cognition.getUsageHandler({
        body: { ...rest, include_users: users?.map((u) => u.id) },
      }),
    );
  }

  constructor(private readonly client: MacroClient) {}

  /**
   * Generate an answer matching a JSON Schema. Set toolset to { type: 'none' }
   * to use only supplied context. Other toolsets can perform the requested
   * actions; always inspect outcome and toolActivity, including interruptions.
   */
  async structuredCompletion(
    request: StructuredCompletionRequest,
  ): Promise<StructuredCompletionResponse> {
    return unwrap(
      await this.client.cognition.structuredCompletion({ body: request }),
    );
  }

  /**
   * Ask named yes/no questions about JSON input. Each probability estimates
   * yes, from 0 to 1. This classifies supplied data without running tools.
   */
  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    return unwrap(await this.client.cognition.decisions({ body: request }));
  }
}
