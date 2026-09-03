//! Rules for rendering mathematical expressions.

use crate::types::StaticPrompt;

static TITLE: &str = "Math Rendering Rules";

static INSTRUCTIONS: &str = r##"- Render **all mathematical expressions** (even simple arithmetic) with Macro equation XML tags.
- Put the LaTeX expression in the `equation` field. Both `equation` and `inline` are required.
- Use `"inline":true` for math within a sentence:
  `<m-katex-equation>{"equation":"E = mc^2","inline":true}</m-katex-equation>`
- Use `"inline":false` for standalone display math:
  `<m-katex-equation>{"equation":"\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}","inline":false}</m-katex-equation>`
- Escape LaTeX backslashes for the JSON string, as shown above.
- Do not use raw LaTeX delimiters such as `$...$`, `$$...$$`, `\(...\)`, or `\[...\]`.
"##;

static INTENT: &str = "All mathematical expressions, including simple arithmetic, use Macro's \
equation XML tags with the required equation and inline fields, never raw LaTeX delimiters.";

/// The math-rendering prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
