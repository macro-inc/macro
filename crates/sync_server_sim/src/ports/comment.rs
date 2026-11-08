//! Recorded verdicts or a caller-supplied, synchronous native application gate.
use super::*;

/// Pure native evaluator over the real proposed roots and injected port clock.
pub type CommentEvaluator = fn(&RootChange, SimNow) -> Result<bool, SimError>;

impl SimPorts {
    /// Queue recorded comment-service verdicts; absent evaluator/verdicts fail closed.
    pub fn seed_verdicts(&self, values: impl IntoIterator<Item = Result<bool, SimError>>) {
        self.0.borrow_mut().verdicts.extend(values);
    }
    /// Install the native application evaluator, preserving recorded-verdict overrides.
    pub fn set_comment_gate(&self, evaluator: CommentEvaluator) {
        self.0.borrow_mut().comment_gate = Some(evaluator);
    }
}
impl CommentGate for SimPorts {
    type Error = SimError;
    async fn is_comment_only_change(&self, change: &RootChange) -> Result<bool, SimError> {
        self.enter(
            "comment_gate.check",
            json!({"before":change.before,"after":change.after}),
        )
        .await?;
        let mut state = self.0.borrow_mut();
        if let Some(verdict) = state.verdicts.pop_front() {
            return verdict;
        }
        match state.comment_gate {
            Some(evaluate) => evaluate(change, state.now),
            None => Ok(false),
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use futures::FutureExt;

    fn evaluate(change: &RootChange, now: SimNow) -> Result<bool, SimError> {
        assert_eq!(change.before, json!({"original":true}));
        assert_eq!(change.after, json!({"proposed":true}));
        assert_eq!(now.unix_ms, 1234);
        Ok(true)
    }

    #[test]
    fn cold_gate_preserves_roots_clock_and_recorded_verdict_precedence() {
        let ports = SimPorts::new();
        ports.set_now(SimNow {
            unix_ms: 1234,
            monotonic: Duration::from_millis(42),
        });
        ports.set_comment_gate(evaluate);
        let cold = ports.fork_durable();
        let change = RootChange {
            before: json!({"original":true}),
            after: json!({"proposed":true}),
        };
        assert!(
            cold.is_comment_only_change(&change)
                .now_or_never()
                .unwrap()
                .unwrap()
        );
        cold.seed_verdicts([Ok(false)]);
        assert!(
            !cold
                .is_comment_only_change(&change)
                .now_or_never()
                .unwrap()
                .unwrap()
        );
        assert!(
            cold.is_comment_only_change(&change)
                .now_or_never()
                .unwrap()
                .unwrap()
        );
        assert!(
            !SimPorts::new()
                .is_comment_only_change(&change)
                .now_or_never()
                .unwrap()
                .unwrap()
        );
    }
}
