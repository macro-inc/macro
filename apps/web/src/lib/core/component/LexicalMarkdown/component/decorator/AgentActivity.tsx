import { AgentActivity as AgentActivityView } from '@app/features/agent-activity/agent-activity';
import type { AgentActivityDecoratorProps } from '@macro-inc/lexical-core';
import type { Component } from 'solid-js';

/** The steps of an agent's reply, live where the session is readable. */
export const AgentActivity: Component<AgentActivityDecoratorProps> = (
  props
) => (
  <AgentActivityView
    agentSessionId={props.agentSessionId}
    turn={props.turn}
    segment={props.segment}
    rows={props.rows}
    sealed={props.sealed}
  />
);
