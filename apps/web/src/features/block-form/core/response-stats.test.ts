import { expect, it } from 'vitest';
import { responseTiles } from './response-stats';

const gateName = (sectionId: string) =>
  sectionId === 'gate-eligibility' ? 'Eligibility' : 'Travel';

it('reads the ledger, the table and the channel reach as tiles', () => {
  expect(
    responseTiles(
      {
        submitted: 19,
        stopped: 3,
        stoppedBySection: [
          { sectionId: 'gate-eligibility', count: 2 },
          { sectionId: 'gate-travel', count: 1 },
        ],
        rows: 21,
      },
      40,
      gateName
    )
  ).toEqual([
    { label: 'Responses', value: '19' },
    {
      label: 'Stopped submissions',
      value: '3',
      hint: 'Signed-in respondents only · Eligibility 2 · Travel 1',
    },
    {
      label: 'Rows in the table',
      value: '21',
      hint: 'Includes rows added in the grid',
    },
    {
      label: 'People in its channels',
      value: '40',
      hint: 'Can respond through its channel posts, you excluded',
    },
  ]);
  expect(
    responseTiles(
      { submitted: 2, stopped: 0, stoppedBySection: [], rows: 2 },
      'none',
      gateName
    )
  ).toEqual([
    { label: 'Responses', value: '2' },
    {
      label: 'Stopped submissions',
      value: '0',
      hint: 'Signed-in respondents only',
    },
    { label: 'Rows in the table', value: '2' },
  ]);
});

it('shows a dash, never a ratio, when the form is public or its reach is still unknown', () => {
  const counts = { submitted: 2, stopped: 0, stoppedBySection: [], rows: 2 };
  expect(responseTiles(counts, 'public', gateName).at(-1)).toEqual({
    label: 'People in its channels',
    value: '—',
    hint: 'Anyone with the link can respond',
  });
  expect(responseTiles(counts, 'unknown', gateName).at(-1)).toEqual({
    label: 'People in its channels',
    value: '—',
    hint: 'Counting the people in its channels…',
  });
});
