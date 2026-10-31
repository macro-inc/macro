import type { AnswerToolApprovalRequest } from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { AgentSession } from './agent-session';

/** A permission request scoped to its originating agent session. */
export class ToolApproval {
  private constructor(
    private readonly client: MacroClient,
    /** Owning session. */
    readonly session: AgentSession,
    /** Approval identity. */
    readonly id: string,
  ) {}

  /** Construct a scoped approval handle. */
  static byId(
    client: MacroClient,
    session: AgentSession,
    id: string,
  ): ToolApproval {
    return new ToolApproval(client, session, id);
  }

  /** Answer the approval using the generated discriminated answer contract. */
  async answer(answer: AnswerToolApprovalRequest['answer']) {
    return unwrap(
      await this.client.agentHarness.answerAgentSessionToolApproval({
        path: { session_id: this.session.id, approval_id: this.id },
        body: { answer },
      }),
    );
  }

  /** Serialize scoped identity only. */
  toJSON() {
    return { id: this.id, sessionId: this.session.id };
  }
}
