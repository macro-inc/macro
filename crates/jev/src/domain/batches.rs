//! Asking more questions than one decision takes: split into requests of at
//! most [`MAX_QUESTIONS`], run concurrently under one deadline, and answered in
//! the order asked.

use std::fmt::Display;
use std::future::Future;
use std::time::Duration;

use futures::StreamExt as _;
use futures::stream::FuturesUnordered;

use super::models::{DecisionRequest, DecisionResponse, MAX_QUESTIONS};

#[cfg(test)]
mod test;

/// One question's answer.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Answer {
    /// The probability of yes.
    Probability(f32),
    /// The call that asked it failed or left it out.
    Failed,
    /// The call that asked it had not answered by the deadline.
    TimedOut,
}

/// How a batched decision went overall.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BatchedOutcome {
    /// At least one call answered; unanswered questions say why.
    Answered,
    /// No call answered, and at least one was still running at the deadline.
    TimedOut,
    /// Every call failed.
    Failed,
}

/// The answers to [`decide_in_batches`], one per question, in the order asked.
#[derive(Debug, Clone, PartialEq)]
pub struct BatchedDecision {
    /// One answer per question, in the order asked.
    pub answers: Vec<Answer>,
    /// Calls made: one per [`MAX_QUESTIONS`] questions, rounded up.
    pub batches: usize,
}

impl BatchedDecision {
    /// Whether any call answered, and if none did, why.
    pub fn outcome(&self) -> BatchedOutcome {
        let answered = self
            .answers
            .iter()
            .any(|answer| matches!(answer, Answer::Probability(_)));
        let timed_out = self.answers.contains(&Answer::TimedOut);

        if answered || self.answers.is_empty() {
            BatchedOutcome::Answered
        } else if timed_out {
            BatchedOutcome::TimedOut
        } else {
            BatchedOutcome::Failed
        }
    }
}

/// Ask `questions` about `input` through `decide`, at most [`MAX_QUESTIONS`]
/// per call, all calls at once. Answers that arrive within `deadline` are
/// kept; a call that fails or is late loses only its own questions.
#[tracing::instrument(
    name = "jev.decide_in_batches",
    skip_all,
    fields(
        questions = questions.len(),
        batches = tracing::field::Empty,
        failed = tracing::field::Empty,
        timed_out = tracing::field::Empty,
    )
)]
pub async fn decide_in_batches<Decide, Decision, Error>(
    input: &serde_json::Value,
    questions: &[String],
    deadline: Duration,
    decide: Decide,
) -> BatchedDecision
where
    Decide: Fn(DecisionRequest) -> Decision,
    Decision: Future<Output = Result<DecisionResponse, Error>>,
    Error: Display,
{
    let until = tokio::time::Instant::now() + deadline;
    let mut pending: FuturesUnordered<_> = questions
        .chunks(MAX_QUESTIONS)
        .enumerate()
        .map(|(batch, chunk)| {
            let first = batch * MAX_QUESTIONS;
            let request = DecisionRequest {
                input: input.clone(),
                questions: chunk
                    .iter()
                    .enumerate()
                    .map(|(offset, question)| ((first + offset).to_string(), question.clone()))
                    .collect(),
            };
            let decision = decide(request);
            async move { (first..first + chunk.len(), decision.await) }
        })
        .collect();
    let mut decision = BatchedDecision {
        answers: vec![Answer::TimedOut; questions.len()],
        batches: pending.len(),
    };
    let mut failed = 0;

    while let Ok(Some((asked, result))) = tokio::time::timeout_at(until, pending.next()).await {
        let response = match result {
            Ok(response) => response,
            Err(error) => {
                failed += 1;
                tracing::warn!(error = %error, "a batch of decisions failed");
                DecisionResponse {
                    probabilities: Default::default(),
                }
            }
        };
        for index in asked {
            decision.answers[index] = response
                .probabilities
                .get(&index.to_string())
                .map_or(Answer::Failed, |probability| {
                    Answer::Probability(*probability)
                });
        }
    }

    let span = tracing::Span::current();
    span.record("batches", decision.batches);
    span.record("failed", failed);
    span.record("timed_out", pending.len());
    decision
}
