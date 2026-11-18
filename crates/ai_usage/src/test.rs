use super::*;
use crate::domain::financial::{FinalizeInvocation, WriteDisposition};
use std::sync::Mutex;

#[derive(Default)]
struct Recorded(Mutex<Vec<UsageEvent>>);

impl UsageRecorder for Recorded {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

struct Observations;

impl UsageTracking for Observations {
    fn begin(&self, _: TrackedInvocation) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async { Ok(WriteDisposition::Inserted) })
    }

    fn finalize(&self, _: FinalizeInvocation) -> FinancialFuture<'_, WriteDisposition> {
        Box::pin(async { Ok(WriteDisposition::Inserted) })
    }
}

fn web_search_credits() -> UsageEvent {
    UsageContext::system(AiFeature::WebSearch).into_provider_credits_event("tavily".into(), 1)
}

#[test]
fn a_sessions_tools_record_their_usage_as_part_of_it() {
    let recorded = Arc::new(Recorded::default());
    let session = Uuid::from_u128(1);
    let other_session = Uuid::from_u128(2);
    let recorder = for_agent_session(recorded.clone(), session);

    recorder.record(web_search_credits());
    recorder.record(UsageEvent {
        agent_session_id: Some(other_session),
        ..web_search_credits()
    });

    let sessions: Vec<_> = recorded
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|event| event.agent_session_id)
        .collect();
    assert_eq!(sessions, vec![Some(session), Some(other_session)]);
}

#[test]
fn a_sessions_tools_keep_the_observation_journal() {
    let tracking: Arc<dyn UsageTracking> = Arc::new(Observations);
    let recorder = for_agent_session(
        with_tracking(Arc::new(Recorded::default()), tracking.clone()),
        Uuid::from_u128(1),
    );

    assert!(Arc::ptr_eq(&recorder.tracking().unwrap(), &tracking));
}
