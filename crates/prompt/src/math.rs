//! Rules for Macro's internal markdown, especially math, tables, and the
//! XML tags that GFM does not have.
//!
//! In-app replies, channel messages, email bodies, and Markdown documents are
//! parsed as Macro internal markdown. Standard GFM (headings, lists, emphasis,
//! code fences) is fine; math, tables, and entity mentions must use the
//! `<m-*>` XML tags below, not GFM `$$` / pipe-table / `@mention` equivalents.

use crate::types::StaticPrompt;

static TITLE: &str = "Internal Markdown";

static INSTRUCTIONS: &str = r##"Macro parses **internal markdown**, not GitHub Flavored Markdown, everywhere you author Markdown: your own conversational replies, `SendChannelMessage` content, `SendEmail` bodies, and `CreateDocument`/`EditDocument` content for Markdown (`.md`) documents. Ordinary Markdown (headings, lists, emphasis, code fences, links) is fine. For math, tables, and entity mentions, always emit Macro's internal XML tags — never the GFM equivalents.

### Math

Render **all mathematical expressions** (even simple arithmetic) as LaTeX inside an `<m-katex-equation>` tag whose body is a JSON object with `equation` (the LaTeX source) and `inline` (`true` for in-sentence math, `false` for display/block math).

- Inline: `<m-katex-equation>{"equation":"2 + 2 = 4","inline":true}</m-katex-equation>`
- Fractions: `<m-katex-equation>{"equation":"\\frac{1}{2}","inline":true}</m-katex-equation>`
- Display: `<m-katex-equation>{"equation":"x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}","inline":false}</m-katex-equation>`
- Multi-line:
  `<m-katex-equation>{"equation":"\\begin{aligned}\nf(x) &= x^2 + 3x + 2 \\\\\n     &= (x+1)(x+2)\n\\end{aligned}","inline":false}</m-katex-equation>`

Never wrap math in `$$...$$`, `$...$`, `\(...\)`, or `\[...\]`. Those are GFM/TeX delimiters and will not render as equations.

### Tables

Use `<m-table>` / `<m-table-row>` / `<m-table-cell>` XML, not GitHub pipe tables (`| col |`). Mark header cells with `header="row"`. Cell text can itself contain internal markdown (including `<m-katex-equation>` and mention tags). Use `\\n` for a line break inside a cell.

Example:
`<m-table><m-table-row><m-table-cell header="row">Name</m-table-cell><m-table-cell header="row">Value</m-table-cell></m-table-row><m-table-row><m-table-cell>pi</m-table-cell><m-table-cell><m-katex-equation>{"equation":"\\pi","inline":true}</m-katex-equation></m-table-cell></m-table-row></m-table>`

### Mentions

Entity mentions use the `<m-document-mention>` / `<m-user-mention>` XML tags described in the mentioning section — never GFM `@name` or a bare URL when a mention tag exists.
"##;

static INTENT: &str = "Markdown is authored in Macro's internal XML syntax: math in \
<m-katex-equation> tags with inline true/false, tables in <m-table> XML, and entities \
as mention tags — never GFM $$ / $ / \\( \\) math or pipe tables.";

/// Compact always-on reminder injected as `<global_instructions>` on every
/// in-process agent-session turn. Complements the full section above, which
/// already lives in the standing tool-use prompt; this block sits after that
/// prompt so the syntax rule is not buried in the long standing text.
pub const GLOBAL_INSTRUCTIONS: &str = r#"Author every reply in Macro internal markdown. Use `<m-katex-equation>{"equation":"<latex>","inline":<bool>}</m-katex-equation>` for math, `<m-table>` / `<m-table-row>` / `<m-table-cell>` for tables, and `<m-*>` mention tags for entities. Never use GFM math (`$$`, `$`, `\(...\)`, `\[...\]`) or pipe tables."#;

/// The internal-markdown prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
