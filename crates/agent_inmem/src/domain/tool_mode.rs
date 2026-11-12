//! Which tools a turn presents.

/// Tool presentation for one request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolMode {
    /// The direct Macro tools.
    Standard,
    /// Code mode: the SDK replaces every direct tool it covers.
    Code,
}
