import { expect, it } from 'vitest';
import { chat, messages } from '../tests/fake-capabilities';
import { messageTask } from './task';

it('titles a task from the message text and assigns the Macro users it mentions', () => {
  expect(
    messageTask(
      {
        ...messages[0],
        mentions: [
          {
            token: '14155550100',
            name: 'Ana Ruiz',
            userId: 'macro|ana@example.test',
          },
          { token: '14155550111', name: 'Bo Chen' },
        ],
        body: '@14155550100 please send @14155550111 the *updated* designs before the review on Friday morning',
      },
      chat
    )
  ).toEqual({
    title:
      'please send @Bo Chen the *updated* designs before the review on Friday...',
    content:
      '<m-document-mention>{"documentId":"019a061e-0000-7000-8000-000000000001","documentName":"Design Crit","blockName":"external_chat"}</m-document-mention>',
    assigneeIds: ['macro|ana@example.test'],
  });
});

it('makes no task from pending, deleted or system rows', () => {
  expect(messageTask({ ...messages[0], pending: true }, chat)).toBeUndefined();
  expect(messageTask({ ...messages[0], deleted: true }, chat)).toBeUndefined();
  expect(
    messageTask(
      {
        ...messages[0],
        kind: 'system',
        body: '',
        rich: {
          type: 'system',
          action: 'call',
          participants: [],
          call: { video: true, outcome: 'missed' },
        },
      },
      chat
    )
  ).toBeUndefined();
});
