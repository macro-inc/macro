//! Value objects for yes/no classification.

use std::fmt;

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// Longest question accepted, in characters.
pub const MAX_QUESTION_CHARS: usize = 500;
/// Most questions evaluated against one input in a single request.
pub const MAX_QUESTIONS: usize = 32;

/// A natural-language yes/no question, trimmed and bounded.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct YesNoQuestion(String);

impl YesNoQuestion {
    /// The trimmed question text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for YesNoQuestion {
    type Error = QuestionError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(QuestionError::Empty);
        }
        if trimmed.chars().count() > MAX_QUESTION_CHARS {
            return Err(QuestionError::TooLong);
        }
        Ok(Self(trimmed.to_owned()))
    }
}

impl TryFrom<&str> for YesNoQuestion {
    type Error = QuestionError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_from(value.to_owned())
    }
}

impl From<YesNoQuestion> for String {
    fn from(question: YesNoQuestion) -> Self {
        question.0
    }
}

impl fmt::Display for YesNoQuestion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Why a question was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum QuestionError {
    /// The question has no text after trimming.
    #[error("a question needs text")]
    Empty,
    /// The question is longer than [`MAX_QUESTION_CHARS`].
    #[error("a question can be at most {MAX_QUESTION_CHARS} characters")]
    TooLong,
}

/// The model's belief, from 0 to 1, that a question's answer is yes.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize)]
pub struct Probability(f32);

impl Probability {
    /// A probability, or `None` when the value is not finite or outside 0..=1.
    pub fn new(value: f32) -> Option<Self> {
        (value.is_finite() && (0.0..=1.0).contains(&value)).then_some(Self(value))
    }

    /// The probability as a number from 0 to 1.
    pub fn get(self) -> f32 {
        self.0
    }
}

/// One provider round trip: an answer per question, in question order, plus
/// the provider-reported token usage for metering.
#[derive(Debug, Clone, PartialEq)]
pub struct Evaluation {
    /// Probability of yes for each question, in the order asked.
    pub probabilities: Vec<Probability>,
    /// Input tokens the provider billed.
    pub input_tokens: u64,
    /// Output tokens the provider billed.
    pub output_tokens: u64,
}

/// Classification failures. Provider details stay in the adapter's logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum JevError {
    /// No questions were asked.
    #[error("no questions to classify")]
    NoQuestions,
    /// More than [`MAX_QUESTIONS`] questions were asked at once.
    #[error("at most {MAX_QUESTIONS} questions can be classified at once")]
    TooManyQuestions,
    /// A timeout, connection failure, rate limit, overload or server error.
    /// Retrying later may succeed.
    #[error("the classifier is temporarily unavailable")]
    Unavailable,
    /// The provider refused the request, e.g. a bad credential or an input
    /// it cannot evaluate. Retrying the same request will not help.
    #[error("the classifier rejected the request")]
    Rejected,
    /// The provider answered, but not with one probability per question.
    #[error("the classifier returned an unusable response")]
    InvalidResponse,
}

impl JevError {
    /// Whether the same request may succeed later.
    pub fn is_transient(self) -> bool {
        matches!(self, Self::Unavailable)
    }
}
