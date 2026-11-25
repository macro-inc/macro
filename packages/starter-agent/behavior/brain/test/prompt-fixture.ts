import { queued } from './fixture.ts';

export const charter =
  '# Fixture constitution\r\n\r\nUse only approved instructions.\r\n';
export const pack = '# Fixture task pack\n\nSummarize the supplied record.';
const encoder = new TextEncoder();
export const job = {
  ...queued.job,
  prompt: {
    ...queued.job.prompt,
    constitution: {
      ...queued.job.prompt.constitution,
      charterSha256:
        '732bd25325f24a24d212fb44d849b538234a6ea646aa491c17edb590007e88f3',
    },
  },
};
export const trusted = {
  constitution: {
    repoHeadSha: job.prompt.constitution.repoHeadSha,
    bytes: encoder.encode(charter),
  },
  taskPack: { ...job.prompt.taskPack, bytes: encoder.encode(pack) },
  state: {
    code: {
      catalog: 'readRecord: Read the supplied record.',
      script: { file: '/fixture/behavior/index.ts', name: 'Script' },
      describe: async () => '',
      execute: async () => ({
        kind: 'failed' as const,
        error: 'Offline fixture',
        logs: '',
      }),
    },
  },
};
export const input = {
  request: 'Summarize the record.',
  event: { name: 'record', payload: { title: 'Fixture record' } },
};
