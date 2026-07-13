//! The EventBridge payload this lambda is invoked with.
//!
//! Each scheduled EventBridge rule fires at a frequency matching one refresh
//! cadence and passes a constant input of the form `{"refresh_cadence":"high"}`.
//! Because the target uses a constant input, the lambda receives this object
//! verbatim rather than the usual EventBridge envelope.

/// How frequently the projections of this cadence are swept. The concrete
/// schedule frequency lives in infrastructure; here the value only selects which
/// projection definitions a given invocation operates on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RefreshCadence {
    /// Swept most frequently.
    High,
    /// Swept at a moderate frequency.
    Medium,
    /// Swept least frequently.
    Low,
}

impl RefreshCadence {
    /// The value as stored in `ai_projection.refresh_cadence`, used to scope
    /// queries to the cadence this invocation is responsible for.
    pub fn as_str(self) -> &'static str {
        match self {
            RefreshCadence::High => "high",
            RefreshCadence::Medium => "medium",
            RefreshCadence::Low => "low",
        }
    }
}

/// The payload delivered by the scheduled EventBridge rule.
#[derive(Debug, serde::Deserialize)]
pub struct RefreshEvent {
    /// The cadence whose projections this invocation should sweep.
    pub refresh_cadence: RefreshCadence,
}
