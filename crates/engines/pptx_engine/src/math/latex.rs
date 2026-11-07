//! The LaTeX-style linear format (PowerPoint's LaTeX equation input).
//!
//! The dialect is LaTeX math as people type it: `\frac{}{}`, `^`, `_`,
//! `\sqrt[n]{}`, large operators with limits (`\sum_{i=1}^{n}`, `\int`,
//! `\prod`, `\lim_{x\to 0}`), `\left( \right)` with `\middle`, the
//! `matrix`/`pmatrix`/`bmatrix`/`Bmatrix`/`vmatrix`/`cases`/`aligned`
//! environments, accents (`\hat \bar \vec \dot \ddot \tilde \check`),
//! `\overline`, `\underline`, `\overbrace{}^{}`, `\underbrace{}_{}`,
//! `\overset`/`\underset`, `\boxed`, `\cancel`, `\phantom`, Greek letters
//! and the usual symbols, `\mathrm \mathbf \mathit \mathbb \mathcal
//! \mathfrak \mathsf \mathtt`, `\text{}`, and spacing (`\, \: \; \quad`).
//!
//! It follows OMML where LaTeX has no structure: a pair of brackets such
//! as `(…)` or `[0, 1)` becomes a growing delimiter (as PowerPoint does
//! when you type one), a function's argument is what follows it up to the
//! next operator, and so is a large operator's operand unless it is
//! braced. Two forms have no LaTeX spelling and use their own commands:
//! `\sfrac{a}{b}` (skewed fraction) and `\lfrac{a}{b}` (linear fraction).
//! A top-level `\\` starts a new line of a display equation.

mod parse;
mod write;

use super::tree::{Equation, List};

/// Why linear text could not be read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LatexError {
    /// What is wrong, for the person (or AI) who typed it.
    pub message: String,
}

impl LatexError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for LatexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// Reads linear text into an equation; `display` makes it a display
/// equation (its own paragraph, large operators at full size).
pub fn parse_latex(src: &str, display: bool) -> Result<Equation, LatexError> {
    let mut parser = parse::Parser::new(src);
    let lines: Vec<List> = parser.lines()?.into_iter().map(parse::merge).collect();
    let mut eq = Equation::new(display, Vec::new());
    eq.lines = if display {
        lines
    } else {
        // An inline equation has one line.
        vec![lines.into_iter().flatten().collect()]
    };
    Ok(eq)
}

/// Writes an equation as linear text (lines of a display equation
/// separated by `\\`).
pub fn to_latex(eq: &Equation) -> String {
    eq.lines
        .iter()
        .map(|line| list_to_latex(line))
        .collect::<Vec<_>>()
        .join(" \\\\ ")
}

/// Writes math items as linear text.
pub fn list_to_latex(list: &[super::tree::Node]) -> String {
    let mut out = write::Out::default();
    write::write_list(list, &mut out, false);
    out.s
}
