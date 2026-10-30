import { agentHarnessServiceClient } from '@service-agent-harness/client';

export const fetchAgentSession: typeof agentHarnessServiceClient.get = (
  ...args
) => agentHarnessServiceClient.get(...args);

export const createAgentSession: typeof agentHarnessServiceClient.create = (
  ...args
) => agentHarnessServiceClient.create(...args);

export const fetchAgentQueue: typeof agentHarnessServiceClient.queue = (
  ...args
) => agentHarnessServiceClient.queue(...args);

export const editQueuedAgentAction: typeof agentHarnessServiceClient.editQueued =
  (...args) => agentHarnessServiceClient.editQueued(...args);

export const removeQueuedAgentAction: typeof agentHarnessServiceClient.removeQueued =
  (...args) => agentHarnessServiceClient.removeQueued(...args);

export const steerQueuedAgentAction: typeof agentHarnessServiceClient.steerQueued =
  (...args) => agentHarnessServiceClient.steerQueued(...args);
