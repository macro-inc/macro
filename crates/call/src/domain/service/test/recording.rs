use super::*;
use crate::domain::ports::{RecordingDownload, RecordingStorage};
use futures::StreamExt;

struct FakeRecordingStorage {
    chunks: Option<Vec<Vec<u8>>>,
}

impl RecordingStorage for FakeRecordingStorage {
    async fn open_recording(
        &self,
        recording_key: &str,
    ) -> anyhow::Result<Option<RecordingDownload>> {
        assert_eq!(recording_key, "recording.mp4");
        Ok(self.chunks.as_ref().map(|chunks| RecordingDownload {
            content_type: "video/mp4".to_string(),
            content_length: chunks.iter().map(|chunk| chunk.len() as u64).sum(),
            chunks: Box::pin(futures::stream::iter(chunks.clone().into_iter().map(Ok))),
        }))
    }

    async fn presign_recording_url(&self, _: &str) -> anyhow::Result<String> {
        unreachable!()
    }

    async fn presign_recording_preview_url(&self, _: &str) -> anyhow::Result<String> {
        unreachable!()
    }

    async fn delete_recording(&self, _: &str) -> anyhow::Result<()> {
        unreachable!()
    }

    async fn delete_recording_preview(&self, _: &str) -> anyhow::Result<()> {
        unreachable!()
    }
}

fn recording_service(key: Option<&str>, chunks: Option<Vec<Vec<u8>>>) -> impl CallService {
    let mut record = call_record_for_mutation();
    record.channel_id = None;
    record.recording_key = key.map(str::to_string);

    let mut repo = MockCallRepository::new();
    repo.expect_get_call_record_by_call_id()
        .times(1)
        .return_once(move |call_id| {
            assert_eq!(*call_id, MUTATED_EVENT_CALL_ID);
            Box::pin(async move { Ok(Some(record)) })
        });

    let service: CallServiceImpl<_, _, _, _, _, _, NoopCallSummarizer> = CallServiceImpl::new(
        repo,
        MockRtcClient::new(),
        StubConnectionService,
        NoOpEntityAccessService,
        StubNotificationIngress,
        FakeRecordingStorage { chunks },
        "wss://example.com",
    );
    service
}

#[tokio::test]
async fn download_streams_recording_chunks() {
    let recording = recording_service(Some("recording.mp4"), Some(vec![vec![1, 2], vec![3, 4, 5]]))
        .get_call_recording(reader_receipt())
        .await
        .unwrap();

    assert_eq!(recording.content_type, "video/mp4");
    assert_eq!(recording.content_length, 5);
    assert_eq!(
        recording
            .chunks
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect::<anyhow::Result<Vec<_>>>()
            .unwrap(),
        vec![vec![1, 2], vec![3, 4, 5]]
    );
}

#[tokio::test]
async fn download_returns_not_found_without_recording() {
    let result = recording_service(None, None)
        .get_call_recording(reader_receipt())
        .await;
    assert!(matches!(result, Err(CallError::NotFound(_))));
}

#[tokio::test]
async fn download_returns_not_found_when_object_is_missing() {
    let result = recording_service(Some("recording.mp4"), None)
        .get_call_recording(reader_receipt())
        .await;
    assert!(matches!(result, Err(CallError::NotFound(_))));
}
