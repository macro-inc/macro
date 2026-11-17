import { describe, expect, it } from 'vitest';
import type { Mention } from '../../core/rich';
import { markdownToSlack, slackToMarkdown } from './formatting';

const MENTIONS: Mention[] = [
  { token: 'U01DANA', name: 'Dana Kim', userId: 'macro|dana@acme.test' },
  { token: 'U02RAJ', name: 'Raj' },
];

describe('slackToMarkdown', () => {
  it('turns mentions, channels, here and formatting into Markdown', () => {
    expect(
      slackToMarkdown(
        'Hi <@U01DANA> and <@U02RAJ>, see *launch* plan in <#C123|shared-launch> <!here>',
        MENTIONS
      )
    ).toBe(
      'Hi <m-user-mention>{"userId":"macro|dana@acme.test","email":"dana@acme.test","displayName":"Dana Kim"}</m-user-mention> and **@Raj**&#44; see **launch** plan in **#shared&#45;launch** **@here**'
    );
  });

  it('links web addresses with their labels and decodes entities', () => {
    expect(
      slackToMarkdown(
        'Docs: <https://acme.test/a?b=1&amp;c=2|the plan> and <https://x.test>'
      )
    ).toBe(
      'Docs&#58; [the plan](https://acme.test/a?b=1&c=2) and [https&#58;&#47;&#47;x&#46;test](https://x.test)'
    );
  });

  it('keeps quotes, bullets and preformatted blocks', () => {
    expect(slackToMarkdown('&gt; quoted _it_ ~gone~')).toBe(
      '> quoted *it* ~~gone~~'
    );
    expect(slackToMarkdown('• one\n• two')).toBe('- one\n- two');
    expect(slackToMarkdown('```\nlet x = a &lt; b;\n```')).toBe(
      '```\nlet x = a < b;\n```'
    );
  });

  it('never lets sender text become a link, tag or Markdown', () => {
    expect(
      slackToMarkdown('<javascript:alert(1)|click> [x](y) **not bold**')
    ).toBe('click &#91;x&#93;&#40;y&#41; &#42;&#42;not bold&#42;&#42;');
    expect(slackToMarkdown('<@U09UNKNOWN>')).toBe('**@someone**');
  });
});

describe('markdownToSlack', () => {
  it('writes mrkdwn and escapes what Slack would read as syntax', () => {
    expect(
      markdownToSlack(
        '**bold** and *it* ~~s~~ [plan](https://a.test/x) a < b & c'
      )
    ).toBe('*bold* and _it_ ~s~ <https://a.test/x|plan> a &lt; b &amp; c');
    expect(markdownToSlack('# Title\n- one\n> quote\n```\nx < y\n```')).toBe(
      '*Title*\n• one\n&gt; quote\n```x &lt; y```'
    );
  });
});
