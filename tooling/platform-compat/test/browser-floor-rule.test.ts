import { describe, it } from 'bun:test';
import typescriptParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';
import { browserFloorRule } from '../src/browser-floor-rule';

RuleTester.describe = describe;
RuleTester.it = it;

const safari = [{ browserslist: ['safari >= 15.4'] }];
const tester = new RuleTester({
  languageOptions: { parser: typescriptParser },
});

tester.run('browser-floor', browserFloorRule, {
  valid: [
    { code: 'structuredClone(value); crypto.randomUUID();', options: safari },
    { code: 'let worker: SharedWorker | undefined;', options: safari },
    {
      code: 'const SharedWorker = class {}; new SharedWorker();',
      options: safari,
    },
    {
      code: "if (typeof SharedWorker === 'function') new SharedWorker('worker.js');",
      options: safari,
    },
    {
      code: 'const worker = window.SharedWorker ? new SharedWorker("w.js") : undefined;',
      options: safari,
    },
    { code: 'navigator.vibrate?.(10);', options: safari },
    {
      code: 'void navigator.permissions?.query({ name: "camera" });',
      options: safari,
    },
    {
      code: "function connect() { if (!('SharedWorker' in window)) return; return () => new SharedWorker('w.js'); }",
      options: safari,
    },
    {
      code: "function start() { if (typeof SharedWorker !== 'function') throw new Error('unsupported'); return new SharedWorker('w.js'); }",
      options: safari,
    },
    { code: "try { new SharedWorker('w.js'); } catch {}", options: safari },
    { code: "'a<br/>'.replace(/(.)<br\\/>$/, '$1');", options: safari },
    {
      code: 'AbortSignal.any([signal]);',
      options: [{ browserslist: ['safari >= 17.4'] }],
    },
  ],
  invalid: [
    {
      code: 'AbortSignal.any([signal]);',
      options: safari,
      errors: [
        {
          messageId: 'unsupported',
          data: {
            feature: 'AbortSignal.any',
            browser: 'Safari',
            floor: '15.4',
            added: 'added in 17.4',
          },
        },
      ],
    },
    {
      code: 'AbortSignal.timeout(1000);',
      options: [{ browserslist: ['ios_saf >= 15.4'] }],
      errors: [
        {
          messageId: 'unsupported',
          data: {
            feature: 'AbortSignal.timeout',
            browser: 'Safari on iOS',
            floor: '15.4',
            added: 'added in 16',
          },
        },
      ],
    },
    {
      code: 'const deferred = Promise.withResolvers();',
      options: safari,
      errors: [{ messageId: 'unsupported' }],
    },
    {
      code: "if (ready) new SharedWorker('w.js');",
      options: safari,
      errors: [{ messageId: 'unsupported' }],
    },
    {
      code: 'navigator.permissions.query({ name: "camera" });',
      options: safari,
      errors: [{ messageId: 'unsupported' }],
    },
    {
      code: 'window.requestIdleCallback(work);',
      options: safari,
      errors: [
        {
          messageId: 'unsupported',
          data: {
            feature: 'requestIdleCallback',
            browser: 'Safari',
            floor: '15.4',
            added: 'never released there',
          },
        },
      ],
    },
    {
      code: 'const endBreak = /(?<=.)<br\\/>$/;',
      options: safari,
      errors: [
        {
          messageId: 'unsupported',
          data: {
            feature: 'javascript.regular_expressions.lookbehind_assertion',
            browser: 'Safari',
            floor: '15.4',
            added: 'added in 16.4',
          },
        },
      ],
    },
    {
      code: "const pattern = new RegExp('(?<=a)b');",
      options: safari,
      errors: [{ messageId: 'unsupported' }],
    },
    {
      code: 'const pattern = /[\\p{L}--a]/v;',
      options: safari,
      errors: [{ messageId: 'unsupported' }],
    },
  ],
});
