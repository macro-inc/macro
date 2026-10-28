//! Jev domain: question and probability value objects, the provider port, and
//! the metered classification use case. No transport or infrastructure lives here.

#[cfg(feature = "decisions")]
pub mod decisions;
pub mod models;
pub mod ports;
pub mod service;

pub use models::{
    DecisionRequest, DecisionResponse, DecisionValidationError, Evaluation, JevError,
    MAX_DECISION_KEY_BYTES, MAX_DECISION_REQUEST_BYTES, MAX_QUESTION_CHARS, MAX_QUESTIONS,
    Probability, QuestionError, YesNoQuestion,
};
pub use ports::{JevProvider, YesNoClassifier};
pub use service::JevClassifier;
