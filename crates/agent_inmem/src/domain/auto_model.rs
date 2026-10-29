//! Which model an Auto turn runs on.

use std::{collections::BTreeMap, future::Future, pin::Pin, sync::Arc, time::Duration};

use cognition::domain::{Cognition, DecisionRequest};
use macro_user_id::user_id::MacroUserIdStr;
use tracing::Instrument as _;

use super::models::resolve;

#[cfg(test)]
mod test;

/// The model a prompt needing high intelligence runs on.
pub const HIGH_MODEL: &str = "anthropic/claude-opus-5-5";

/// The model a prompt that is neither hard nor simple runs on.
pub const MID_MODEL: &str = "openai/gpt-6.1-sol";

/// Asked first: a yes runs the turn on [`HIGH_MODEL`].
const HIGH_QUESTION: &str = "Does this request require higher intelligence?";

/// Asked alongside: a yes, without a yes to [`HIGH_QUESTION`], keeps the turn
/// on Auto's default model; a no runs it on [`MID_MODEL`].
const LOW_QUESTION: &str = "Is this request simple enough for a smaller, faster model?";

/// Decision keys for [`HIGH_QUESTION`] and [`LOW_QUESTION`].
const HIGH_KEY: &str = "high";
const LOW_KEY: &str = "simple";

/// How long a turn waits on Jev before running on Auto's default model.
const DECISION_TIMEOUT: Duration = Duration::from_secs(1);

/// Jev's probability at or above which a question counts as yes.
const YES_THRESHOLD: f32 = 0.5;

/// Choose the routable model for one Auto turn from its prompt.
pub trait AutoModelSelector: Send + Sync {
    /// The model id the turn runs on. Never fails: an unavailable classifier
    /// keeps the turn on Auto's default model.
    fn select<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'static>,
        prompt: &'a str,
    ) -> Pin<Box<dyn Future<Output = &'static str> + Send + 'a>>;
}

/// Auto without a classifier: every turn runs on Auto's default model.
pub struct DefaultAutoModel;

impl AutoModelSelector for DefaultAutoModel {
    fn select<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'static>,
        _: &'a str,
    ) -> Pin<Box<dyn Future<Output = &'static str> + Send + 'a>> {
        Box::pin(async { resolve(super::models::AUTO_MODEL) })
    }
}

/// Asks Jev, through cognition's named decisions, how much intelligence the
/// prompt needs: [`HIGH_MODEL`] for hard prompts, Auto's default for simple
/// ones, [`MID_MODEL`] otherwise.
pub struct JevAutoModel {
    cognition: Arc<dyn Cognition>,
}

impl JevAutoModel {
    /// Compose with the host's cognition client, which meters each decision.
    pub fn new(cognition: Arc<dyn Cognition>) -> Self {
        Self { cognition }
    }
}

impl AutoModelSelector for JevAutoModel {
    fn select<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'static>,
        prompt: &'a str,
    ) -> Pin<Box<dyn Future<Output = &'static str> + Send + 'a>> {
        Box::pin(async move {
            let span = tracing::info_span!(
                "agent.auto_model",
                agent.auto_model.high = tracing::field::Empty,
                agent.auto_model.low = tracing::field::Empty,
                agent.auto_model.selected = tracing::field::Empty,
                agent.auto_model.outcome = tracing::field::Empty,
            );
            let request = DecisionRequest {
                input: serde_json::json!({ "request": prompt }),
                questions: BTreeMap::from([
                    (HIGH_KEY.to_owned(), HIGH_QUESTION.to_owned()),
                    (LOW_KEY.to_owned(), LOW_QUESTION.to_owned()),
                ]),
            };
            let answer =
                tokio::time::timeout(DECISION_TIMEOUT, self.cognition.decide(owner, request))
                    .instrument(span.clone())
                    .await;
            let probabilities = match &answer {
                Ok(Ok(response)) => response
                    .probabilities
                    .get(HIGH_KEY)
                    .zip(response.probabilities.get(LOW_KEY)),
                _ => None,
            };
            let selected = match probabilities {
                Some((&high, &low)) => {
                    span.record("agent.auto_model.high", high);
                    span.record("agent.auto_model.low", low);
                    span.record("agent.auto_model.outcome", "classified");
                    if high >= YES_THRESHOLD {
                        HIGH_MODEL
                    } else if low >= YES_THRESHOLD {
                        resolve(super::models::AUTO_MODEL)
                    } else {
                        MID_MODEL
                    }
                }
                None => {
                    let outcome = match &answer {
                        Err(_) => "timeout",
                        Ok(Err(_)) => "provider_error",
                        Ok(Ok(_)) => "invalid_response",
                    };
                    span.record("agent.auto_model.outcome", outcome);
                    span.in_scope(|| {
                        tracing::warn!(
                            outcome,
                            error = ?answer.as_ref().ok().and_then(|result| result.as_ref().err()),
                            "Auto model classification failed; using the default"
                        );
                    });
                    resolve(super::models::AUTO_MODEL)
                }
            };
            span.record("agent.auto_model.selected", selected);
            selected
        })
    }
}
