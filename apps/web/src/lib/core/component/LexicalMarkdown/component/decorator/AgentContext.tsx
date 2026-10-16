import type { AgentContextDecoratorProps } from '@macro-inc/lexical-core';
import type { Component } from 'solid-js';

/**
 * The context the harness gives an agent stays hidden: the prompt says where
 * it came from on its own line, `PromptOrigin` in block-agent.
 */
export const AgentContext: Component<AgentContextDecoratorProps> = () => null;
