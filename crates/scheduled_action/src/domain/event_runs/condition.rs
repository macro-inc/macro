//! Trigger conditions: before a matched event starts its run, the triggering
//! content must answer one of the matching filters' yes/no questions with yes.
//! Content is read as the routine owner, through the run's access receipt.

use std::sync::Arc;

use ai_usage::{AiFeature, UsageContext};
use jev::domain::{Probability, YesNoClassifier, YesNoQuestion};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde_json::Value;

use super::AuthorizedEventRun;

#[cfg(test)]
mod test;

/// A condition is met when the classifier's probability of yes reaches this.
pub const CONDITION_THRESHOLD: f32 = 0.5;

/// Reads what a triggering event is about, as JSON for the classifier.
///
/// Read only what the run's access receipt covers. Content that no longer
/// exists (e.g. a deleted document) is described as such, not an error;
/// infrastructure failure is `Err` and is retried.
pub trait EventContentReader: Send + Sync + 'static {
    fn read(
        &self,
        owner: &MacroUserIdStr<'static>,
        run: &AuthorizedEventRun,
    ) -> impl Future<Output = Result<Value, Report>> + Send;
}

/// The answer to a run's conditions, with the highest probability of yes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ConditionVerdict {
    Met(Probability),
    NotMet(Probability),
}

#[derive(Debug)]
pub enum ConditionError {
    /// This host has no classifier configured.
    Unconfigured,
    /// Reading content or classifying failed; a later attempt may succeed.
    Transient(Report),
    /// The classifier refused this input; retrying will not help.
    Permanent(Report),
}

/// Decides whether a matched run's conditions hold.
pub trait EventConditionCheck: Send + Sync + 'static {
    fn check(
        &self,
        owner: &MacroUserIdStr<'static>,
        run: &AuthorizedEventRun,
        conditions: &[YesNoQuestion],
    ) -> impl Future<Output = Result<ConditionVerdict, ConditionError>> + Send;
}

/// For hosts without a classifier: no condition can be checked.
pub struct NoConditionCheck;

impl EventConditionCheck for NoConditionCheck {
    async fn check(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &AuthorizedEventRun,
        _: &[YesNoQuestion],
    ) -> Result<ConditionVerdict, ConditionError> {
        Err(ConditionError::Unconfigured)
    }
}

/// A host-optional check: `None` means no classifier is configured.
impl<T: EventConditionCheck> EventConditionCheck for Option<T> {
    async fn check(
        &self,
        owner: &MacroUserIdStr<'static>,
        run: &AuthorizedEventRun,
        conditions: &[YesNoQuestion],
    ) -> Result<ConditionVerdict, ConditionError> {
        match self {
            Some(check) => check.check(owner, run, conditions).await,
            None => Err(ConditionError::Unconfigured),
        }
    }
}

/// Reads the triggering content and asks every condition about it in one
/// classifier call, metered against the routine owner.
pub struct ConditionGate<R, C> {
    content: Arc<R>,
    classifier: Arc<C>,
}

impl<R, C> ConditionGate<R, C> {
    pub fn new(content: Arc<R>, classifier: Arc<C>) -> Self {
        Self {
            content,
            classifier,
        }
    }
}

impl<R: EventContentReader, C: YesNoClassifier> EventConditionCheck for ConditionGate<R, C> {
    #[tracing::instrument(name = "routine.condition", skip_all, fields(
        action_id = %run.pending.action_id,
        event_name = run.pending.event.event_name().as_str(),
        conditions = conditions.len(),
        probability = tracing::field::Empty,
    ))]
    async fn check(
        &self,
        owner: &MacroUserIdStr<'static>,
        run: &AuthorizedEventRun,
        conditions: &[YesNoQuestion],
    ) -> Result<ConditionVerdict, ConditionError> {
        let input = self
            .content
            .read(owner, run)
            .await
            .map_err(ConditionError::Transient)?;
        let usage = UsageContext::new(AiFeature::Automation, owner.clone())
            .with_entity(Some(run.pending.action_id));
        let probabilities = self
            .classifier
            .classify(usage, &input, conditions)
            .await
            .map_err(|error| {
                let report = Report::new(error).into_dynamic();
                if error.is_transient() {
                    ConditionError::Transient(report)
                } else {
                    ConditionError::Permanent(report)
                }
            })?;
        let Some(best) = probabilities
            .into_iter()
            .max_by(|left, right| left.get().total_cmp(&right.get()))
        else {
            return Err(ConditionError::Permanent(rootcause::report!(
                "the classifier answered no conditions"
            )));
        };
        tracing::Span::current().record("probability", best.get());
        Ok(if best.get() >= CONDITION_THRESHOLD {
            ConditionVerdict::Met(best)
        } else {
            ConditionVerdict::NotMet(best)
        })
    }
}
