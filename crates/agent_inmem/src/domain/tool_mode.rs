//! Which tools a turn presents.

/// Tool presentation for one turn.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolMode {
    /// The direct Macro tools: turns that cannot run code (summaries,
    /// sessions without a user owner, or no code runner reachable).
    Standard,
    /// Code mode: the SDK replaces every direct tool it covers.
    Code,
}
