import { describe, expect, it } from 'vitest';
import {
  buildEmbedUrl,
  buildIosCommentBody,
  extractPublicKeyFromBody,
  findIosPreviewComment,
  IOS_PREVIEW_MARKER,
  PREVIEW_DEVICES,
} from './appetize';

describe('buildEmbedUrl', () => {
  it('pins the device and disables autoplay', () => {
    expect(buildEmbedUrl('abc123', 'iphone15pro')).toBe(
      'https://appetize.io/app/abc123?device=iphone15pro&autoplay=false'
    );
  });

  it('omits osVersion so links survive runtime retirement', () => {
    expect(buildEmbedUrl('abc123', 'iphone15pro')).not.toContain('osVersion');
  });
});

describe('buildIosCommentBody', () => {
  const input = {
    publicKey: 'abc123',
    branchName: 'wolf/ios-thing',
    commitSha: 'deadbeefcafe1234',
  };

  it('carries the marker so the comment can be found again', () => {
    expect(buildIosCommentBody(input)).toContain(IOS_PREVIEW_MARKER);
  });

  it('offers one link per device', () => {
    const body = buildIosCommentBody(input);
    for (const device of PREVIEW_DEVICES) {
      expect(body).toContain(`device=${device.slug}`);
      expect(body).toContain(device.label);
    }
  });

  it('shortens the sha and names the branch', () => {
    const body = buildIosCommentBody(input);
    expect(body).toContain('`deadbee`');
    expect(body).toContain('`wolf/ios-thing`');
    expect(body).not.toContain('deadbeefcafe1234');
  });

  it('never mentions the web preview domain', () => {
    // Sharing that substring would make `get-or-create-id.ts` mistake this for
    // the web preview comment and scrape a bogus preview id out of it.
    expect(buildIosCommentBody(input)).not.toContain('preview.macro.com');
  });
});

describe('extractPublicKeyFromBody', () => {
  it('recovers the key from a posted comment', () => {
    const body = buildIosCommentBody({
      publicKey: 'k3yw1thd1g1ts',
      branchName: 'main',
      commitSha: 'abcdef1',
    });
    expect(extractPublicKeyFromBody(body)).toBe('k3yw1thd1g1ts');
  });

  it('returns null when there is no key', () => {
    expect(extractPublicKeyFromBody('no preview here')).toBe(null);
  });
});

describe('findIosPreviewComment', () => {
  const iosComment = {
    id: 1,
    body: `${IOS_PREVIEW_MARKER}\nhttps://appetize.io/app/abc123`,
    user: { type: 'Bot' },
  };

  it('finds the bot comment carrying the marker', () => {
    expect(findIosPreviewComment([iosComment])?.id).toBe(1);
  });

  it('ignores the web preview comment', () => {
    const webComment = {
      id: 2,
      body: '**Preview:** https://feat-abc123.preview.macro.com/app (abcdef1)',
      user: { type: 'Bot' },
    };
    expect(findIosPreviewComment([webComment])).toBe(null);
  });

  it('ignores a human quoting the marker', () => {
    const humanComment = {
      id: 3,
      body: `why is there a ${IOS_PREVIEW_MARKER} in here`,
      user: { type: 'User' },
    };
    expect(findIosPreviewComment([humanComment])).toBe(null);
  });
});

describe('roundtrip', () => {
  it('recovers the key it wrote', () => {
    const publicKey = 'roundtripkey';
    const body = buildIosCommentBody({
      publicKey,
      branchName: 'wolf/x',
      commitSha: '1234567890',
    });
    expect(extractPublicKeyFromBody(body)).toBe(publicKey);
  });
});
