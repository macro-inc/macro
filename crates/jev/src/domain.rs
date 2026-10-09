//! Jev domain: question and probability value objects, the provider port, and
//! the metered classification use case. No transport or infrastructure lives here.

pub mod models;
pub mod ports;
pub mod service;

pub use models::{
    Evaluation, JevError, MAX_QUESTION_CHARS, MAX_QUESTIONS, Probability, QuestionError,
    YesNoQuestion,
};
pub use ports::{JevProvider, YesNoClassifier};
pub use service::JevClassifier;
