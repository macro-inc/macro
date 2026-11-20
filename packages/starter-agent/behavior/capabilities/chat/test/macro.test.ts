import { expect, test } from 'bun:test';
import type { Macro } from '@macro-inc/sdk';
import { sdkChat } from '../macro.ts';

const agentId = 'macro|agent@example.invalid';

test("the agent's own id is asked again after Macro was unreachable, not remembered as a failure", async () => {
  let asked = 0;
  const macro = {
    users: {
      me: async () => {
        asked += 1;
        if (asked === 1) throw new Error('Unable to connect');
        return { id: agentId };
      },
    },
  };
  const chat = sdkChat({
    macro: async () => macro as unknown as Macro,
    myName: 'Agent',
  });
  await expect(chat.me()).rejects.toThrow('Unable to connect');
  expect(chat.reached()).toBe(false);
  expect(await chat.me()).toBe(agentId);
  // Macro answered: the agent is online, whatever its stream does.
  expect(chat.reached()).toBe(true);
  await chat.reachable();
  expect(await chat.me()).toBe(agentId);
  expect(asked).toBe(2);
});
