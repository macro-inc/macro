//! Equations (PowerPoint's Insert ▸ Equation): Office Math in DrawingML
//! text, typeset natively.
//!
//! An equation is one item of a paragraph, like a field: it counts as one
//! character (U+FFFC in paragraph text) for carets, selections, and text
//! positions, and is edited as a whole through its linear form. The
//! modules here read and write OMML ([`omml`]), convert to and from the
//! LaTeX-style linear format ([`latex`]), typeset ([`layout`]), and give
//! the plain text other readers fall back to ([`text`]).

mod font;
pub mod latex;
pub mod layout;
pub mod omml;
pub mod preview;
mod symbols;
pub mod text;
mod tree;

pub use latex::{LatexError, list_to_latex, parse_latex, to_latex};
pub use layout::{MathBox, MathGlyph, MathItem, typeset};
pub use omml::{equation_element, is_equation_item, read_equation};
pub use text::plain_text;
pub use tree::*;

/// The character an equation stands as in paragraph text.
pub const OBJECT_CHAR: char = '\u{FFFC}';

#[cfg(test)]
mod test;
