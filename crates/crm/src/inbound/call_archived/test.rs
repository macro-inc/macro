use std::sync::{Arc, Mutex};

use call::domain::{
    events::{CallArchiveReason, CallRecordArchivedMetadata, CallRecordDeletedMetadata},
    models::{CallError, CallPeople, CallRecord, GetCallRecordsRequest},
};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;

const CALL_RECORD_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5b701);

fn people() -> CallPeople {
    CallPeople {
        user_ids: vec![MacroUserIdStr::try_from_email("rep@ours.com").unwrap()],
        invitee_emails: vec!["buyer@acme.com".to_string()],
    }
}

/// Serves fixed call people after failing the first `failures` lookups, or
/// always fails when `people` is `None`.
struct FakeCalls {
    people: Option<CallPeople>,
    failures: Mutex<u32>,
    lookups: Arc<Mutex<u32>>,
}

impl CallRecordQueryService for FakeCalls {
    async fn get_user_call_records(
        &self,
        _req: GetCallRecordsRequest,
    ) -> Result<Vec<CallRecord>, CallError> {
        Ok(Vec::new())
    }

    async fn get_call_record_people(&self, _call_record_id: Uuid) -> Result<CallPeople, CallError> {
        *self.lookups.lock().unwrap() += 1;
        let mut failures = self.failures.lock().unwrap();
        if *failures > 0 {
            *failures -= 1;
            return Err(CallError::NotFound("call record".to_string()));
        }
        self.people
            .clone()
            .ok_or_else(|| CallError::NotFound("call record".to_string()))
    }
}

/// Records each link it is asked to write.
#[derive(Default)]
struct RecordingLinks {
    links: Mutex<Vec<(Uuid, CallPeople)>>,
}

impl CallRecordLinkStore for Arc<RecordingLinks> {
    async fn link_call_record(
        &self,
        call_record_id: Uuid,
        people: &CallPeople,
    ) -> Result<(), Report> {
        self.links
            .lock()
            .unwrap()
            .push((call_record_id, people.clone()));
        Ok(())
    }
}

fn consumer_failing(
    people: Option<CallPeople>,
    failures: u32,
) -> (
    CallArchivedConsumer<FakeCalls, Arc<RecordingLinks>>,
    Arc<RecordingLinks>,
    Arc<Mutex<u32>>,
) {
    let links = Arc::new(RecordingLinks::default());
    let lookups = Arc::new(Mutex::new(0));
    let mut consumer = CallArchivedConsumer::new(CallRecordLinker::new(
        FakeCalls {
            people,
            failures: Mutex::new(failures),
            lookups: lookups.clone(),
        },
        links.clone(),
    ));
    consumer.first_retry_delay = std::time::Duration::ZERO;
    (consumer, links, lookups)
}

fn consumer(
    people: Option<CallPeople>,
) -> (
    CallArchivedConsumer<FakeCalls, Arc<RecordingLinks>>,
    Arc<RecordingLinks>,
) {
    let (consumer, links, _) = consumer_failing(people, 0);
    (consumer, links)
}

fn archived() -> CallTopicEvent {
    CallTopicEvent::RecordArchived(CallRecordArchivedMetadata {
        call_id: CALL_RECORD_ID,
        channel_id: None,
        created_by: MacroUserIdStr::try_from_email("rep@ours.com").unwrap(),
        started_at: Utc::now(),
        ended_at: Utc::now(),
        duration_ms: Some(1_000),
        participant_count: 1,
        has_recording: false,
        archive_reason: CallArchiveReason::LastParticipantLeft,
    })
}

#[tokio::test]
async fn archived_calls_are_linked_with_the_people_on_them() {
    let (consumer, links) = consumer(Some(people()));

    consumer.apply(&archived()).await.unwrap();

    assert_eq!(
        *links.links.lock().unwrap(),
        vec![(CALL_RECORD_ID, people())]
    );
}

#[tokio::test]
async fn other_call_events_are_ignored() {
    let (consumer, links) = consumer(Some(people()));

    consumer
        .apply(&CallTopicEvent::RecordDeleted(CallRecordDeletedMetadata {
            call_id: CALL_RECORD_ID,
            channel_id: None,
            actor_user_id: None,
        }))
        .await
        .unwrap();

    assert!(links.links.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failed_people_lookup_fails_the_event() {
    let (consumer, links) = consumer(None);

    assert!(consumer.apply(&archived()).await.is_err());
    assert!(links.links.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failed_link_is_retried_until_it_succeeds() {
    let (consumer, links, lookups) = consumer_failing(Some(people()), 2);

    consumer.apply_with_retries(&archived()).await;

    assert_eq!(*lookups.lock().unwrap(), 3);
    assert_eq!(
        *links.links.lock().unwrap(),
        vec![(CALL_RECORD_ID, people())]
    );
}

#[tokio::test]
async fn a_link_that_keeps_failing_is_given_up_after_the_attempt_limit() {
    let (consumer, links, lookups) = consumer_failing(None, 0);

    consumer.apply_with_retries(&archived()).await;

    assert_eq!(*lookups.lock().unwrap(), MAX_ATTEMPTS);
    assert!(links.links.lock().unwrap().is_empty());
}
