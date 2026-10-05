//! PDF functions: sampled (type 0), exponential (2), stitching (3), and
//! PostScript calculator (4).

use crate::error::Result;
use crate::pdf::{Object, Resolve};

/// A function.
#[derive(Clone, Debug, PartialEq)]
pub struct Function {}

impl Function {
    /// Reads a function (a dictionary or stream), or an array of
    /// single-output functions acting as one.
    pub fn parse(pdf: &dyn Resolve, value: &Object) -> Result<Function> {
        let _ = (pdf, value);
        todo!("Function::parse")
    }

    /// Evaluates at `input` (clipped to the domain); outputs are clipped to
    /// the range when there is one.
    pub fn eval(&self, input: &[f32]) -> Vec<f32> {
        let _ = input;
        todo!("Function::eval")
    }
}
