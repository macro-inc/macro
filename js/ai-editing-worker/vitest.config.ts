import { defineConfig, type Plugin } from 'vitest/config';

/** Wrangler bundles `**\/*.md` as text modules (see wrangler.toml [[rules]]);
 *  mirror that for tests so files importing prompts are loadable. */
function mdAsText(): Plugin {
  return {
    name: 'md-as-text',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.md')) return null;
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    },
  };
}

export default defineConfig({
  plugins: [mdAsText()],
});
