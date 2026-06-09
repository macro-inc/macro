//! Rules for rendering mathematical expressions.

use crate::types::StaticPrompt;

static TITLE: &str = "Math Rendering Rules";

static INSTRUCTIONS: &str = r##"- Render **all mathematical expressions** (even simple arithmetic) in LaTeX enclosed with double dollar signs `$$ ... $$`.
- Examples:
  - Simple: $$ 2 + 2 = 4 $$
  - Fractions: $$ \frac{1}{2} $$
  - Quadratic formula: $$ x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a} $$
  - Multi-line:
    $$
    \begin{aligned}
    f(x) &= x^2 + 3x + 2 \\
         &= (x+1)(x+2)
    \end{aligned}
    $$
"##;

static INTENT: &str = "All mathematical expressions, including simple arithmetic, are rendered \
as LaTeX enclosed in double dollar signs.";

/// The math-rendering prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
