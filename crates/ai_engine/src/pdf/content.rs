//! Content streams: the operators and operands that draw a page, with
//! inline images, and writing operators back.

use super::{Dict, Object};
use std::ops::Range;

/// An inline image (`BI … ID … EI`).
#[derive(Clone, Debug, PartialEq)]
pub struct InlineImage {
    /// The image dictionary (abbreviated keys as written).
    pub dict: Dict,
    /// The image data, still filtered.
    pub data: Vec<u8>,
}

/// One operator with its operands.
#[derive(Clone, Debug, PartialEq)]
pub struct Op {
    /// The operator (`re`, `f`, `Tj`, `BDC`, …).
    pub operator: Vec<u8>,
    /// Its operands, in order.
    pub operands: Vec<Object>,
    /// The inline image of a `BI` operator.
    pub inline_image: Option<InlineImage>,
    /// Where the operator and its operands were in the stream.
    pub span: Range<usize>,
}

impl Op {
    /// An operator built in code (no span).
    pub fn new(operator: &str, operands: Vec<Object>) -> Op {
        Op {
            operator: operator.as_bytes().to_vec(),
            operands,
            inline_image: None,
            span: 0..0,
        }
    }

    /// Whether the operator is `name`.
    pub fn is(&self, name: &str) -> bool {
        self.operator == name.as_bytes()
    }

    /// Operand `i` as a number.
    pub fn num(&self, i: usize) -> f64 {
        self.operands.get(i).and_then(Object::as_f64).unwrap_or(0.0)
    }
}

/// Splits a content stream into operators. Damaged input is skipped up to
/// the next operator rather than failing.
pub fn parse(content: &[u8]) -> Vec<Op> {
    let _ = content;
    todo!("content::parse")
}

/// Writes operators as a content stream (one per line).
pub fn write(ops: &[Op]) -> Vec<u8> {
    let _ = ops;
    todo!("content::write")
}
