import { describe, expect, it } from 'vitest';
import {
  markdownToEmbeddingText,
  markdownToPlainText,
  parseContactMentions,
  parseDateMentions,
  parseDocumentMentions,
  parseGroupMentions,
  parseLinks,
  parsePullRequestMentions,
  parseUserMentions,
} from '../utils/parsers';

describe('parseUserMentions', () => {
  it('extracts email from user mention', () => {
    const input =
      '<m-user-mention>{"email":"john@example.com"}</m-user-mention>';
    expect(parseUserMentions(input)).toBe('john@example.com');
  });

  it('returns empty string for missing email', () => {
    const input = '<m-user-mention>{"name":"John"}</m-user-mention>';
    expect(parseUserMentions(input)).toBe('');
  });

  it('returns empty string for invalid JSON', () => {
    const input = '<m-user-mention>invalid</m-user-mention>';
    expect(parseUserMentions(input)).toBe('');
  });

  it('handles multiple mentions', () => {
    const input =
      'Hello <m-user-mention>{"email":"a@b.com"}</m-user-mention> and <m-user-mention>{"email":"c@d.com"}</m-user-mention>';
    expect(parseUserMentions(input)).toBe('Hello a@b.com and c@d.com');
  });

  it('passes through text without mentions', () => {
    const input = 'Hello world';
    expect(parseUserMentions(input)).toBe('Hello world');
  });
});

describe('parseContactMentions', () => {
  it('extracts name from contact mention', () => {
    const input = '<m-contact-mention>{"name":"Jane Doe"}</m-contact-mention>';
    expect(parseContactMentions(input)).toBe('Jane Doe');
  });

  it('falls back to emailOrDomain when name is missing', () => {
    const input =
      '<m-contact-mention>{"emailOrDomain":"jane@example.com"}</m-contact-mention>';
    expect(parseContactMentions(input)).toBe('jane@example.com');
  });

  it('prefers name over emailOrDomain', () => {
    const input =
      '<m-contact-mention>{"name":"Jane","emailOrDomain":"jane@example.com"}</m-contact-mention>';
    expect(parseContactMentions(input)).toBe('Jane');
  });

  it('returns empty string for invalid JSON', () => {
    const input = '<m-contact-mention>not-json</m-contact-mention>';
    expect(parseContactMentions(input)).toBe('');
  });
});

describe('parseDateMentions', () => {
  it('extracts displayFormat from date mention', () => {
    const input =
      '<m-date-mention>{"displayFormat":"Tomorrow"}</m-date-mention>';
    expect(parseDateMentions(input)).toBe('Tomorrow');
  });

  it('returns empty string for missing displayFormat', () => {
    const input = '<m-date-mention>{"date":"2024-01-01"}</m-date-mention>';
    expect(parseDateMentions(input)).toBe('');
  });

  it('returns empty string for invalid JSON', () => {
    const input = '<m-date-mention>{broken</m-date-mention>';
    expect(parseDateMentions(input)).toBe('');
  });
});

describe('parseDocumentMentions', () => {
  it('extracts documentName from document mention', () => {
    const input =
      '<m-document-mention>{"documentName":"My Doc"}</m-document-mention>';
    expect(parseDocumentMentions(input)).toBe('My Doc');
  });

  it('returns empty string for missing documentName', () => {
    const input = '<m-document-mention>{"id":"123"}</m-document-mention>';
    expect(parseDocumentMentions(input)).toBe('');
  });

  it('returns empty string for invalid JSON', () => {
    const input = '<m-document-mention>???</m-document-mention>';
    expect(parseDocumentMentions(input)).toBe('');
  });
});

describe('parsePullRequestMentions', () => {
  it('extracts the label from a PR mention', () => {
    const input =
      '<m-pr-mention>{"id":"foreign-1","label":"macro/macro#123 Fix bug"}</m-pr-mention>';
    expect(parsePullRequestMentions(input)).toBe('macro/macro#123 Fix bug');
  });

  it('falls back to the id when label is missing', () => {
    const input = '<m-pr-mention>{"id":"foreign-1"}</m-pr-mention>';
    expect(parsePullRequestMentions(input)).toBe('foreign-1');
  });

  it('returns empty string for invalid JSON', () => {
    const input = '<m-pr-mention>???</m-pr-mention>';
    expect(parsePullRequestMentions(input)).toBe('');
  });
});

describe('parseLinks', () => {
  it('extracts text from link', () => {
    const input =
      '<m-link>{"url":"https://example.com","text":"Example"}</m-link>';
    expect(parseLinks(input)).toBe('Example');
  });

  it('falls back to url when text is missing', () => {
    const input = '<m-link>{"url":"https://example.com"}</m-link>';
    expect(parseLinks(input)).toBe('https://example.com');
  });

  it('prefers text over url', () => {
    const input =
      '<m-link>{"url":"https://example.com","text":"Click here"}</m-link>';
    expect(parseLinks(input)).toBe('Click here');
  });

  it('returns empty string for invalid JSON', () => {
    const input = '<m-link>broken</m-link>';
    expect(parseLinks(input)).toBe('');
  });

  it('handles link with title', () => {
    const input =
      '<m-link>{"url":"https://example.com","text":"Example","title":"A title"}</m-link>';
    expect(parseLinks(input)).toBe('Example');
  });
});

describe('parseGroupMentions', () => {
  it('extracts @alias from group mention', () => {
    const input = '<m-group-mention>{"groupAlias":"here"}</m-group-mention>';
    expect(parseGroupMentions(input)).toBe('@here');
  });

  it('handles missing groupAlias', () => {
    const input = '<m-group-mention>{}</m-group-mention>';
    expect(parseGroupMentions(input)).toBe('@');
  });

  it('handles invalid JSON', () => {
    const input = '<m-group-mention>invalid</m-group-mention>';
    expect(parseGroupMentions(input)).toBe('');
  });

  it('handles multiple group mentions', () => {
    const input =
      '<m-group-mention>{"groupAlias":"here"}</m-group-mention> and <m-group-mention>{"groupAlias":"team"}</m-group-mention>';
    expect(parseGroupMentions(input)).toBe('@here and @team');
  });

  it('passes through text without mentions', () => {
    const input = 'Hello world';
    expect(parseGroupMentions(input)).toBe('Hello world');
  });
});

describe('markdownToPlainText', () => {
  it('converts mixed content to plain text', () => {
    const input =
      'Hello <m-user-mention>{"email":"john@example.com"}</m-user-mention>, ' +
      'please review <m-document-mention>{"documentName":"Report"}</m-document-mention> ' +
      'by <m-date-mention>{"displayFormat":"Friday"}</m-date-mention>.';
    expect(markdownToPlainText(input)).toBe(
      'Hello john@example.com, please review Report by Friday.'
    );
  });

  it('handles text with links', () => {
    const input =
      'Check out <m-link>{"url":"https://example.com","text":"this link"}</m-link> for more info.';
    expect(markdownToPlainText(input)).toBe(
      'Check out this link for more info.'
    );
  });

  it('handles text with group mentions', () => {
    const input =
      'Hey <m-group-mention>{"groupAlias":"here"}</m-group-mention>, check this out!';
    expect(markdownToPlainText(input)).toBe('Hey @here, check this out!');
  });

  it('handles text with PR mentions', () => {
    const input =
      'See <m-pr-mention>{"id":"foreign-1","label":"macro/macro#123"}</m-pr-mention>.';
    expect(markdownToPlainText(input)).toBe('See macro/macro#123.');
  });

  it('returns original text when no mentions present', () => {
    const input = 'Just plain text here.';
    expect(markdownToPlainText(input)).toBe('Just plain text here.');
  });

  it('handles empty string', () => {
    expect(markdownToPlainText('')).toBe('');
  });
});

describe('markdownToEmbeddingText', () => {
  it('keeps document and channel ids from document mentions', () => {
    const input =
      'Crash reported in <m-document-mention>{"documentId":"0195ceb6-ec2e-7023-80e4-6e084fa6cccd","blockName":"channel","documentName":"bug-reports","blockParams":{"channel_message_id":"019eb797-0ac1-7062-88ff-5202d1c81724"},"collapsed":false}</m-document-mention>';
    expect(markdownToEmbeddingText(input)).toBe(
      'Crash reported in [bug-reports](channel:0195ceb6-ec2e-7023-80e4-6e084fa6cccd#019eb797-0ac1-7062-88ff-5202d1c81724)'
    );
  });

  it('omits the fragment when there is no channel message id', () => {
    const input =
      '<m-document-mention>{"documentId":"doc-1","blockName":"md","documentName":"Report","blockParams":{}}</m-document-mention>';
    expect(markdownToEmbeddingText(input)).toBe('[Report](md:doc-1)');
  });

  it('falls back to the document name without a document id', () => {
    const input =
      '<m-document-mention>{"documentName":"Report"}</m-document-mention>';
    expect(markdownToEmbeddingText(input)).toBe('Report');
  });

  it('keeps ids from document cards', () => {
    const input =
      '<m-document-card>{"documentId":"doc-2","blockName":"md","documentName":"Spec","blockParams":{}}</m-document-card>';
    expect(markdownToEmbeddingText(input)).toBe('[Spec](md:doc-2)');
  });

  it('keeps ids from PR mentions', () => {
    const input =
      'See <m-pr-mention>{"id":"foreign-1","label":"macro/macro#123"}</m-pr-mention>.';
    expect(markdownToEmbeddingText(input)).toBe(
      'See [macro/macro#123](pr:foreign-1).'
    );
  });

  it('keeps link urls', () => {
    const input =
      'See <m-link>{"url":"https://example.com","text":"this link"}</m-link>.';
    expect(markdownToEmbeddingText(input)).toBe(
      'See [this link](https://example.com).'
    );
  });

  it('reduces other mentions like markdownToPlainText', () => {
    const input =
      'Hello <m-user-mention>{"email":"john@example.com"}</m-user-mention> and ' +
      '<m-group-mention>{"groupAlias":"here"}</m-group-mention>, due ' +
      '<m-date-mention>{"displayFormat":"Friday"}</m-date-mention>.';
    expect(markdownToEmbeddingText(input)).toBe(
      'Hello john@example.com and @here, due Friday.'
    );
  });

  it('reduces contact and theme mentions to their names', () => {
    const input =
      'Ping <m-contact-mention>{"contactId":"c1","name":"Ness Chu","emailOrDomain":"ness@macro.com","isCompany":false}</m-contact-mention> re ' +
      '<m-theme-mention>{"name":"onboarding","data":{}}</m-theme-mention>';
    expect(markdownToEmbeddingText(input)).toBe('Ping Ness Chu re onboarding');
  });

  it('keeps ids from snapshots', () => {
    const input =
      '<m-snapshot>{"documentId":"doc-3","documentName":"Spec","blockName":"md","content":"ignored","snapshotDate":"2025-01-01"}</m-snapshot>';
    expect(markdownToEmbeddingText(input)).toBe('[Spec](md:doc-3)');
  });

  it('decodes base64 snapshots', () => {
    const payload = btoa(
      '{"documentId":"doc-3","documentName":"Spec","blockName":"md"}'
    );
    expect(markdownToEmbeddingText(`<m-snapshot>${payload}</m-snapshot>`)).toBe(
      '[Spec](md:doc-3)'
    );
  });

  it('keeps stable ids for dss images and urls for videos', () => {
    const input =
      '<m-image>{"url":"https://signed.example.com/x?sig=abc","alt":"crash screenshot","srcType":"dss","id":"img-1"}</m-image> ' +
      '<m-video>{"url":"https://videos.example.com/v1","srcType":"embed"}</m-video>';
    expect(markdownToEmbeddingText(input)).toBe(
      '[crash screenshot](dss:img-1) [video](https://videos.example.com/v1)'
    );
  });

  it('keeps equation sources and await placeholder text', () => {
    const input =
      '<m-katex-equation>{"equation":"E = mc^2","inline":true}</m-katex-equation> ' +
      '<m-await>{"awaitId":"a1","text":"generating...","inline":true}</m-await>';
    expect(markdownToEmbeddingText(input)).toBe('E = mc^2 generating...');
  });

  it('flattens tables and resolves mentions inside cells', () => {
    const input =
      '<m-table>' +
      '<m-table-row><m-table-cell>Owner</m-table-cell><m-table-cell>Task</m-table-cell></m-table-row>' +
      '<m-table-row><m-table-cell><m-user-mention>{"email":"a@b.com"}</m-user-mention></m-table-cell><m-table-cell>fix\\nbug</m-table-cell></m-table-row>' +
      '</m-table>';
    expect(markdownToEmbeddingText(input)).toBe(
      'Owner | Task\na@b.com | fix bug'
    );
  });

  it('unwraps email thread embeds and resolves mentions inside them', () => {
    const input =
      '<m-email-thread-embed>{"tag":"div","classes":["macro_quote"]}From <m-contact-mention>{"name":"Ness Chu"}</m-contact-mention>:\\nplease fix</m-email-thread-embed>';
    expect(markdownToEmbeddingText(input)).toBe('From Ness Chu:\nplease fix');
  });

  it('drops watermarks and unrecognized m-* tags entirely', () => {
    const input =
      'before <m-watermark>{"content":"made with macro"}</m-watermark>' +
      '<m-future-thing>{"some":"payload"}</m-future-thing> after';
    expect(markdownToEmbeddingText(input)).toBe('before  after');
  });

  it('drops tags with unparseable payloads', () => {
    expect(
      markdownToEmbeddingText(
        'x <m-document-mention>not json</m-document-mention> y'
      )
    ).toBe('x  y');
  });

  it('returns original text when no mentions present', () => {
    expect(markdownToEmbeddingText('Just plain text.')).toBe(
      'Just plain text.'
    );
  });
});
