import { describe, expect, it } from 'vitest';
import { questionExamples } from './question-examples';

describe('database question examples', () => {
  it('uses the selected database’s actual table and column names', () => {
    const examples = questionExamples({
      databaseId: 'db',
      name: 'Roadmap',
      tables: [
        {
          id: 'releases',
          name: 'Releases',
          sqlName: 'releases',
          columns: [
            {
              name: 'Ship date',
              sqlName: 'ship_date',
              type: 'Date',
              multiple: false,
              options: [],
            },
            {
              name: 'Stage',
              sqlName: 'stage',
              type: 'SelectString',
              multiple: false,
              options: ['Planned', 'Shipped'],
            },
          ],
        },
      ],
    });
    expect(examples).toContain('Chart Releases by Stage');
    expect(examples).toContain('List Releases ordered by Ship date');
    expect(examples.join(' ')).not.toContain('customers');
  });
});
