import { expect, it } from 'vitest';
import fixtures from '../../../../../../crates/types/subsequence_match/src/ranking/automated-recipient-fixtures.tsv?raw';
import { isAutomatedAddress } from './automated-address';

it('matches native automated mailbox eligibility without hiding ordinary addresses', () => {
  for (const line of fixtures.trimEnd().split('\n').slice(1)) {
    const [local, automated] = line.split('\t');
    expect(isAutomatedAddress(`${local}@example.com`), local).toBe(
      automated === 'true'
    );
  }
});
