use super::*;
use crate::domain::events::CallTopicEvent;
use crate::domain::records::{CallProvider, ExternalCallId};
use macro_event_broker::{EventBrokerError, MacroEvent};
use std::sync::{Arc, Mutex};

const CALL_ID: Uuid = Uuid::from_u128(0x0198a1b2_c3d4_7e5f_8061_728394a5b6c7);

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@test.com".to_string()).unwrap()
}

struct FixedRepo;

#[async_trait]
impl ImportedCallRepository for FixedRepo {
    async fn upsert(&self, _call: ImportedCall) -> Result<Uuid, rootcause::Report> {
        Ok(CALL_ID)
    }
    async fn list_owned(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<ImportedCallPreview>, rootcause::Report> {
        Ok(vec![])
    }
    async fn read_owned(
        &self,
        _user: &MacroUserIdStr<'static>,
        _id: Uuid,
    ) -> Result<Option<CallEntityRecord>, rootcause::Report> {
        Ok(None)
    }
}

#[derive(Clone, Default)]
struct RecordingBroker(Arc<Mutex<Vec<(String, serde_json::Value)>>>);

impl MacroEventBroker for RecordingBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.0.lock().unwrap().push((
            event.key().to_string(),
            serde_json::to_value(event.event())?,
        ));
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

fn snapshot(namespace: &str) -> ImportedCall {
    ImportedCall {
        source: CallSource {
            user_id: owner(),
            namespace: namespace.into(),
            provider: CallProvider::Granola,
            object_type: "note".into(),
            external_id: ExternalCallId("not_123456789abcde".to_owned()),
            external_url: None,
            external_updated_at: None,
            synced_at: None,
            metadata: Default::default(),
        },
        title: None,
        started_at: None,
        ended_at: None,
        participants: vec![],
        transcript: None,
    }
}

#[tokio::test]
async fn ingest_announces_the_stored_record_for_its_owner() {
    let broker = RecordingBroker::default();
    let service = CallImportServiceImpl(FixedRepo, broker.clone());

    assert_eq!(service.ingest(snapshot("account")).await.unwrap(), CALL_ID);

    let events = broker.0.lock().unwrap().clone();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, CALL_ID.to_string());
    let event: CallTopicEvent = serde_json::from_value(events[0].1.clone()).unwrap();
    let CallTopicEvent::RecordImported(metadata) = event else {
        panic!("expected an imported record event");
    };
    assert_eq!(metadata.call_id, CALL_ID);
    assert_eq!(metadata.owner, owner());
}

#[tokio::test]
async fn rejected_imports_publish_nothing() {
    let broker = RecordingBroker::default();
    let service = CallImportServiceImpl(FixedRepo, broker.clone());

    assert!(service.ingest(snapshot(" ")).await.is_err());
    assert!(broker.0.lock().unwrap().is_empty());
}
