import { expect, test } from 'vitest';
import * as commands from '../commands';
import * as constants from '../constants';
import * as lexical from '../index';

test('public command bindings retain their original identities across imports', () => {
  expect(lexical.createCommand).toBe(commands.createCommand);
  expect(lexical.SELECTION_CHANGE_COMMAND).toBe(
    commands.SELECTION_CHANGE_COMMAND
  );
  expect(lexical.INSERT_PARAGRAPH_COMMAND).toBe(
    commands.INSERT_PARAGRAPH_COMMAND
  );
  const values = new Map<object, string>();
  values.set(commands.FORMAT_TEXT_COMMAND, 'format');
  expect(values.get(lexical.FORMAT_TEXT_COMMAND)).toBe('format');
  expect(lexical.createCommand('same')).not.toBe(lexical.createCommand('same'));
  expect(lexical.COMMAND_PRIORITY_BEFORE_CRITICAL).toBe(
    constants.COMMAND_PRIORITY_BEFORE_CRITICAL
  );
  expect(lexical.HISTORY_MERGE_TAG).toBe(constants.HISTORY_MERGE_TAG);
});
