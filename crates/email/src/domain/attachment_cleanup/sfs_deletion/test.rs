use super::*;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tracing::{Instrument, instrument::WithSubscriber};

const DB_ID: Uuid = Uuid::from_u128(1);
const SFS_ID: Uuid = Uuid::from_u128(2);

#[derive(Debug, PartialEq, Eq)]
enum Effect {
    DeleteFile(Uuid),
    DeleteRecord(Uuid),
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
struct Failure(&'static str);

#[derive(Clone, Default)]
struct Fake {
    effects: Arc<Mutex<Vec<Effect>>>,
    file_error: Arc<Mutex<Option<SfsDeletionError>>>,
    record_error: Arc<Mutex<Option<anyhow::Error>>>,
}

impl SfsFileDeletion for Fake {
    async fn delete_file(&self, sfs_id: Uuid) -> Result<(), SfsDeletionError> {
        self.effects
            .lock()
            .unwrap()
            .push(Effect::DeleteFile(sfs_id));
        match self.file_error.lock().unwrap().take() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

impl SfsDeletionRepository for Fake {
    async fn delete_attachment(&self, db_id: Uuid) -> anyhow::Result<()> {
        self.effects
            .lock()
            .unwrap()
            .push(Effect::DeleteRecord(db_id));
        match self.record_error.lock().unwrap().take() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

fn setup() -> (SfsDeletionService<Fake, Fake>, Fake) {
    let fake = Fake::default();
    (
        SfsDeletionService {
            repository: fake.clone(),
            files: fake.clone(),
        },
        fake,
    )
}

#[derive(Clone, Default)]
struct Output(Arc<Mutex<Vec<u8>>>);

impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn subscriber(output: &Output) -> impl tracing::Subscriber + Send + Sync + 'static {
    let output = output.clone();
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .without_time()
        .with_ansi(false)
        .with_target(false)
        .with_writer(move || output.clone())
        .finish()
}

#[tokio::test]
async fn deletion_and_already_missing_file_preserve_effect_and_event_order() {
    for already_missing in [false, true] {
        let (service, fake) = setup();
        if already_missing {
            *fake.file_error.lock().unwrap() = Some(SfsDeletionError {
                source: anyhow::Error::new(Failure("file absent")),
                response_status: Some(404),
            });
        }
        let output = Output::default();
        assert!(matches!(
            async {
                service
                    .process(Ok((DB_ID, SFS_ID)))
                    .instrument(tracing::info_span!("process_message"))
                    .await
            }
            .with_subscriber(subscriber(&output))
            .await,
            SfsDeletionDisposition::Delete
        ));
        assert_eq!(
            *fake.effects.lock().unwrap(),
            [Effect::DeleteFile(SFS_ID), Effect::DeleteRecord(DB_ID)]
        );
        let missing_event = if already_missing {
            format!(" INFO process_message: File already deleted from SFS sfs_id={SFS_ID}\n")
        } else {
            String::new()
        };
        assert_eq!(
            String::from_utf8(output.0.lock().unwrap().clone()).unwrap(),
            format!(
                "DEBUG process_message: Processing sfs delete message sfs_message=SFSDeleteMessage {{ db_id: {DB_ID}, sfs_id: {SFS_ID} }}\n{missing_event}DEBUG process_message: Successfully deleted attachment from sfs sfs_message=SFSDeleteMessage {{ db_id: {DB_ID}, sfs_id: {SFS_ID} }}\n"
            )
        );
    }
}

#[tokio::test]
async fn every_other_file_failure_retains_the_delivery_without_deleting_the_record() {
    for response_status in [None, Some(400), Some(403), Some(500), Some(503)] {
        let (service, fake) = setup();
        *fake.file_error.lock().unwrap() = Some(SfsDeletionError {
            source: anyhow::Error::new(Failure("file deletion failed")).context("original context"),
            response_status,
        });
        let output = Output::default();
        let SfsDeletionDisposition::LeaveForRedelivery(error) = async {
            service
                .process(Ok((DB_ID, SFS_ID)))
                .instrument(tracing::info_span!("process_message"))
                .await
        }
        .with_subscriber(subscriber(&output))
        .await
        else {
            panic!("file failure must retain the delivery");
        };
        assert_eq!(
            error.downcast_ref::<Failure>().unwrap().0,
            "file deletion failed"
        );
        assert_eq!(
            format!("{error:#}"),
            "original context: file deletion failed"
        );
        assert_eq!(*fake.effects.lock().unwrap(), [Effect::DeleteFile(SFS_ID)]);
        assert_eq!(
            String::from_utf8(output.0.lock().unwrap().clone()).unwrap(),
            format!(
                "DEBUG process_message: Processing sfs delete message sfs_message=SFSDeleteMessage {{ db_id: {DB_ID}, sfs_id: {SFS_ID} }}\n"
            )
        );
    }
}

#[tokio::test]
async fn record_failure_after_file_deletion_retains_the_original_error() {
    for already_missing in [false, true] {
        let (service, fake) = setup();
        if already_missing {
            *fake.file_error.lock().unwrap() = Some(SfsDeletionError {
                source: anyhow::Error::new(Failure("file absent")),
                response_status: Some(404),
            });
        }
        *fake.record_error.lock().unwrap() =
            Some(anyhow::Error::new(Failure("record deletion failed")).context("original context"));
        let output = Output::default();
        let SfsDeletionDisposition::LeaveForRedelivery(error) = service
            .process(Ok((DB_ID, SFS_ID)))
            .with_subscriber(subscriber(&output))
            .await
        else {
            panic!("record failure must retain the delivery");
        };
        assert_eq!(
            error.downcast_ref::<Failure>().unwrap().0,
            "record deletion failed"
        );
        assert_eq!(
            format!("{error:#}"),
            "original context: record deletion failed"
        );
        assert_eq!(
            *fake.effects.lock().unwrap(),
            [Effect::DeleteFile(SFS_ID), Effect::DeleteRecord(DB_ID)]
        );
        let missing_event = if already_missing {
            format!(" INFO File already deleted from SFS sfs_id={SFS_ID}\n")
        } else {
            String::new()
        };
        assert_eq!(
            String::from_utf8(output.0.lock().unwrap().clone()).unwrap(),
            format!(
                "DEBUG Processing sfs delete message sfs_message=SFSDeleteMessage {{ db_id: {DB_ID}, sfs_id: {SFS_ID} }}\n{missing_event}"
            )
        );
    }
}

#[tokio::test]
async fn malformed_body_retains_its_original_error_without_effects_or_processing_events() {
    let (service, fake) = setup();
    let output = Output::default();
    let SfsDeletionDisposition::LeaveForRedelivery(error) = service
        .process(Err(
            anyhow::Error::new(Failure("malformed body")).context("decode context")
        ))
        .with_subscriber(subscriber(&output))
        .await
    else {
        panic!("malformed body must retain the delivery");
    };
    assert_eq!(error.downcast_ref::<Failure>().unwrap().0, "malformed body");
    assert_eq!(format!("{error:#}"), "decode context: malformed body");
    assert!(fake.effects.lock().unwrap().is_empty());
    assert!(output.0.lock().unwrap().is_empty());
}
