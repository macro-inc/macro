// Markdown files are bundled as text modules (see `rules` in wrangler.jsonc).
declare module "*.md" {
  const text: string;
  export default text;
}
