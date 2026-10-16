import { expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import { onFormFirstQuestion } from './forms';
import { formsKeys } from './keys';

vi.hoisted(() => {
  class FakeWebSocket {
    url: string;
    readyState = 1;
    constructor(url: string) {
      this.url = url;
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
    send() {}
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

const detail = (questions: number) => ({
  form: { id: 'form-1', name: 'Team survey' },
  sections: [
    {
      kind: 'questions',
      id: 'section-1',
      questions: Array.from({ length: questions }, (_, index) => ({
        id: `question-${index}`,
      })),
    },
  ],
});

it('calls back once, with the form’s name, when its saved layout first holds a question', () => {
  const built: string[] = [];
  const stop = onFormFirstQuestion('form-1', (name) => built.push(name));
  queryClient.setQueryData(formsKeys.detail('form-1').queryKey, detail(0));
  expect(built).toEqual([]);
  queryClient.setQueryData(formsKeys.detail('form-1').queryKey, detail(1));
  queryClient.setQueryData(formsKeys.detail('form-1').queryKey, detail(2));
  expect(built).toEqual(['Team survey']);
  stop();
});
