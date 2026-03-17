use serde::Serialize;

/// Boost mode
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BoostMode {
    /// Multiply the boost by the function's result
    Multiply,
    /// Replace the boost with the function's result
    Replace,
    /// Add the function's result to the boost
    Sum,
    /// Average the function's result with the boost
    Avg,
    /// Take the maximum of the function's result and the boost
    Max,
    /// Take the minimum of the function's result and the boost
    Min,
}
