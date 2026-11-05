import { assertEquals, assertStringIncludes } from '@std/assert';
import { askContent, rules, sentences } from './brain.ts';

Deno.test('streams sentences without splitting a model version or quoted punctuation', () => {
  assertEquals(sentences('Checking. One sec'), [['Checking.'], ' One sec']);
  assertEquals(sentences('Version 5.5 is'), [[], 'Version 5.5 is']);
  assertEquals(sentences('He said "no." Then'), [['He said "no."'], ' Then']);
  assertStringIncludes(rules(), 'hand_off');
  assertStringIncludes(
    askContent({
      who: 'caller',
      name: 'Caller',
      text: 'What now?',
      context: ['Other: hi'],
      cutOff: true,
    }),
    'Caller [caller] says to you: What now?'
  );
});
