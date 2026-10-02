import { describe, expect, it } from 'vitest';
import { liftChannelMarkdownImages } from './markdown-images';

const FILE_ID = '01234567-89ab-cdef-0123-456789abcdef';
const URL = `https://static.macro.com/file/${FILE_ID}`;

describe('liftChannelMarkdownImages', () => {
  it('lifts a markdown image and leaves the prose', () => {
    const lifted = liftChannelMarkdownImages(
      `Here you go.\n\n![](${URL})\n\nEnjoy.`
    );
    expect(lifted.content).toBe('Here you go.\n\nEnjoy.');
    expect(lifted.images).toEqual([
      {
        entity_id: FILE_ID,
        entity_type: 'static/image',
        width: null,
        height: null,
      },
    ]);
  });

  it('strips external images without attaching them', () => {
    const lifted = liftChannelMarkdownImages(
      'See ![x](https://example.com/cat.png)'
    );
    expect(lifted.content).toBe('See');
    expect(lifted.images).toEqual([]);
  });

  it('ignores images inside fenced code', () => {
    const content = `\`\`\`\n![](${URL})\n\`\`\`\n\nDone.`;
    const lifted = liftChannelMarkdownImages(content);
    expect(lifted.content).toBe(content);
    expect(lifted.images).toEqual([]);
  });

  it('reads positive pixel size from m-image JSON', () => {
    const payload = JSON.stringify({
      url: URL,
      width: 1024,
      height: 768,
    });
    const lifted = liftChannelMarkdownImages(`<m-image>${payload}</m-image>`);
    expect(lifted.content).toBe('');
    expect(lifted.images[0]).toEqual({
      entity_id: FILE_ID,
      entity_type: 'static/image',
      width: 1024,
      height: 768,
    });
  });
});
