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

/// Serves fixed call people, or fails when `people` is `None`.
struct FakeCalls {
    people: Option<CallPeople>,
}

impl CallRecordQueryService for FakeCalls {
    async fn get_user_call_records(
        &self,
        _req: GetCallRecordsRequest,
    ) -> Result<Vec<CallRecord>, CallError> {
        Ok(Vec::new())
    }

    async fn get_call_record_people(&self, _call_record_id: Uuid) -> Result<CallPeople, CallError> {
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

fn consumer(
    people: Option<CallPeople>,
) -> (
    CallArchivedConsumer<FakeCalls, Arc<RecordingLinks>>,
    Arc<RecordingLinks>,
) {
    let links = Arc::new(RecordingLinks::default());
    let consumer =
        CallArchivedConsumer::new(CallRecordLinker::new(FakeCalls { people }, links.clone()));
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
