use serde::Serialize;

/// Score mode
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScoreMode {
    /// Multiply the score by the function's result
    Multiply,
    /// Add the function's result to the score
    Sum,
    /// Average the function's result with the score
    Avg,
    /// Take the minimum of the function's result and the score
    First,
    /// Take the maximum of the function's result and the score
    Max,
    /// Take the minimum of the function's result and the score
    Min,
}
