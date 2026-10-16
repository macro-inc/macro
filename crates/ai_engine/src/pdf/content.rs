//! Content streams: the operators and operands that draw a page, with
//! inline images, and writing operators back.

mod inline;
#[cfg(test)]
mod test;

use super::lexer::Token;
use super::parse::{Mode, Parser};
use super::write;
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

/// Operands an operator may collect; past this the run is junk.
const MAX_OPERANDS: usize = 1 << 16;

/// Splits a content stream into operators. Damaged input is skipped up to
/// the next operator rather than failing.
pub fn parse(content: &[u8]) -> Vec<Op> {
    let mut p = Parser::new(content, 0, Mode::Content);
    let mut ops = Vec::new();
    let mut operands = Vec::new();
    let mut start: Option<usize> = None;
    while let Some(t) = p.next() {
        match t.token {
            Token::Keyword(b"BI") => {
                let (image, end) = inline::read(content, &mut p);
                ops.push(Op {
                    operator: b"BI".to_vec(),
                    operands: Vec::new(),
                    inline_image: Some(image),
                    span: t.start..end,
                });
                operands.clear();
                start = None;
            }
            Token::Keyword(k) if !matches!(k, b"true" | b"false" | b"null") => {
                ops.push(Op {
                    operator: k.to_vec(),
                    operands: std::mem::take(&mut operands),
                    inline_image: None,
                    span: start.unwrap_or(t.start)..t.end,
                });
                start = None;
            }
            Token::ArrayClose | Token::DictClose | Token::Brace(_) | Token::Junk(_) => {
                if operands.is_empty() {
                    start = None;
                }
            }
            _ => {
                let at = t.start;
                if let Some(v) = p.value(t, 0) {
                    if operands.len() >= MAX_OPERANDS {
                        operands.clear();
                        start = None;
                    }
                    start.get_or_insert(at);
                    operands.push(v);
                }
            }
        }
    }
    ops
}

/// Writes operators as a content stream (one per line).
pub fn write(ops: &[Op]) -> Vec<u8> {
    let mut out = Vec::new();
    for op in ops {
        if let Some(image) = &op.inline_image {
            out.extend_from_slice(b"BI");
            for (k, v) in image.dict.iter() {
                out.push(b' ');
                write::name(k, &mut out);
                out.push(b' ');
                write::value(v, &mut out, true);
            }
            out.extend_from_slice(b" ID ");
            out.extend_from_slice(&image.data);
            out.extend_from_slice(b"\nEI\n");
            continue;
        }
        for o in &op.operands {
            write::value(o, &mut out, true);
            out.push(b' ');
        }
        out.extend_from_slice(&op.operator);
        out.push(b'\n');
    }
    out
}
