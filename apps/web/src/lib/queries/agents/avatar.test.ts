import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  error: vi.fn(),
  setAttr: vi.fn(),
}));

vi.mock('@core/constant/servers', () => ({ staticFileIdEndpoint: vi.fn() }));
vi.mock('@core/util/upload', () => ({ uploadFile: vi.fn() }));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: { generateImage: mocks.generate },
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (
      _name: string,
      work: (span: {
        error: typeof mocks.error;
        setAttr: typeof mocks.setAttr;
      }) => Promise<string>
    ) => work({ error: mocks.error, setAttr: mocks.setAttr }),
  },
}));

import { generateAgentAvatar } from './avatar';

const profile = {
  name: 'Assistant',
  role: 'Maintain project notes',
  personality: 'Clear and concise',
};

beforeEach(() => vi.clearAllMocks());

it('generates a square portrait and returns the durable image URL', async () => {
  mocks.generate.mockResolvedValue(
    ok({ url: 'https://example.com/portrait.png' })
  );

  await expect(generateAgentAvatar(profile)).resolves.toBe(
    'https://example.com/portrait.png'
  );
  expect(mocks.generate).toHaveBeenCalledWith({
    aspectRatio: 'square',
    prompt: expect.stringContaining(JSON.stringify(profile)),
  });
  expect(mocks.setAttr).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});

it.each(['response', 'transport'])(
  'preserves %s errors while keeping profile data out of telemetry',
  async (failure) => {
    const transportError = new Error(JSON.stringify(profile));
    if (failure === 'response') {
      mocks.generate.mockResolvedValue(
        err([{ code: 'generation_failed', message: JSON.stringify(profile) }])
      );
    } else {
      mocks.generate.mockRejectedValue(transportError);
    }

    if (failure === 'response') {
      await expect(generateAgentAvatar(profile)).rejects.toMatchObject({
        errors: [
          { code: 'generation_failed', message: JSON.stringify(profile) },
        ],
      });
    } else {
      await expect(generateAgentAvatar(profile)).rejects.toBe(transportError);
    }
    expect(mocks.error).toHaveBeenCalledWith(
      'Agent portrait generation failed'
    );
    expect(mocks.setAttr).not.toHaveBeenCalled();
  }
);
