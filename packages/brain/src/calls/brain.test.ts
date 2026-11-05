import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askContent, rules, sentences } from './brain.ts';

test('streams sentences without splitting a model version or quoted punctuation', () => {
  assert.deepStrictEqual(sentences('Checking. One sec'), [
    ['Checking.'],
    ' One sec',
  ]);
  assert.deepStrictEqual(sentences('Version 5.5 is'), [[], 'Version 5.5 is']);
  assert.deepStrictEqual(sentences('He said "no." Then'), [
    ['He said "no."'],
    ' Then',
  ]);
  assert(rules().includes('hand_off'));
  assert(
    askContent({
      who: 'caller',
      name: 'Caller',
      text: 'What now?',
      context: ['Other: hi'],
      cutOff: true,
    }).includes('Caller [caller] says to you: What now?')
  );
});
