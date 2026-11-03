/**
 * Generate an image and post it to a channel as an image attachment.
 *
 * Usage:
 *   MACRO_API_KEY=mak_... bun examples/generate-image.ts <channel-id> [prompt]
 *
 * The image is charged to your AI allowance. Set MACRO_ENV for dev/prod/local.
 */
import { Macro } from '../src/macro';

const [channelId, prompt = 'A watercolor lighthouse at dusk, soft light'] =
  process.argv.slice(2);
if (!channelId) {
  console.error(
    'usage: MACRO_API_KEY=mak_... bun examples/generate-image.ts <channel-id> [prompt]',
  );
  process.exit(1);
}

const macro = new Macro();

const image = await macro.images.generate({
  prompt,
  aspectRatio: 'widescreen',
});
console.log(`generated ${image.width}×${image.height} ${image.url}`);

// The image carries its width and height, so the message reserves its space
// before the bytes load.
const message = await macro.channels
  .byId(channelId)
  .send(`Generated: ${prompt}`, { images: [image] });
console.log(`posted message ${message.id}`);
