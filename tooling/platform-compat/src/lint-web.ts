// Lints the web app's sources against its browserslist floor. Pass files to
// lint only those that the config covers; with no arguments it lints them all.
import { relative, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { WEB_SOURCES } from './web-sources';

const repoRoot = resolve(import.meta.dir, '../../..');
const requested = process.argv
  .slice(2)
  .map((file) => relative(repoRoot, resolve(file)));

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: resolve(import.meta.dir, '../eslint.config.ts'),
  errorOnUnmatchedPattern: false,
  warnIgnored: false,
});
const linted = await eslint.lintFiles(
  requested.length > 0 ? requested : WEB_SOURCES
);
// The code also carries disable comments for oxlint and generated-code rules
// that this config does not load; only this rule and parse failures count.
const results = linted.map((result) => {
  const messages = result.messages.filter(
    (message) =>
      message.fatal || message.ruleId === 'platform-compat/browser-floor'
  );
  return {
    ...result,
    messages,
    errorCount: messages.length,
    fatalErrorCount: messages.filter((message) => message.fatal).length,
    warningCount: 0,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
    suppressedMessages: [],
  };
});
const formatter = await eslint.loadFormatter('stylish');
const output = await formatter.format(results);
if (output) console.log(output);
if (results.some((result) => result.errorCount > 0)) process.exit(1);
