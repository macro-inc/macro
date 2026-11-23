import { expect, it } from 'vitest';
import {
  COMPUTER_SETUP_PARAM,
  computerSetupPath,
  parseComputerSetupParam,
} from './setup-request';

it('links to Settings → Machines with the computer to resume', () => {
  const path = computerSetupPath('0190f3a1-0000-7000-8000-000000000c01');
  expect(path).toBe(
    '/settings/runtimes?computerSetup=0190f3a1-0000-7000-8000-000000000c01'
  );
  const search = new URL(path, 'https://macro.com/app').searchParams;
  expect(parseComputerSetupParam(search.get(COMPUTER_SETUP_PARAM))).toBe(
    '0190f3a1-0000-7000-8000-000000000c01'
  );
});

it('reads the first value of a repeated parameter and ignores empty ones', () => {
  expect(parseComputerSetupParam(['computer-1', 'computer-2'])).toBe(
    'computer-1'
  );
  expect(parseComputerSetupParam('')).toBeUndefined();
  expect(parseComputerSetupParam('  ')).toBeUndefined();
  expect(parseComputerSetupParam(undefined)).toBeUndefined();
});
