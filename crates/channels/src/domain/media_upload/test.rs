use std::sync::Mutex;

use super::*;

#[derive(Default)]
struct FakeStore {
    reserved: Mutex<Vec<(String, String, String)>>,
    fail: bool,
}

impl StaticMediaStore for FakeStore {
    async fn reserve(
        &self,
        owner: &MacroUserIdStr<'_>,
        file_name: &str,
        content_type: &str,
    ) -> anyhow::Result<StaticMediaReservation> {
        if self.fail {
            anyhow::bail!("store unavailable");
        }
        self.reserved.lock().unwrap().push((
            owner.to_string(),
            file_name.to_string(),
            content_type.to_string(),
        ));
        Ok(StaticMediaReservation {
            file_id: Uuid::nil(),
            upload_url: "https://upload.example.test/put".to_string(),
        })
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|user@example.com").unwrap()
}

fn upload(file_name: &str, content_type: Option<&str>) -> NewChannelMediaUpload {
    NewChannelMediaUpload {
        file_name: file_name.to_string(),
        content_type: content_type.map(str::to_string),
    }
}

#[tokio::test]
async fn infers_video_from_extension() {
    let uploads = ChannelMediaUploads::new(FakeStore::default());

    let reserved = uploads
        .reserve(&owner(), upload("Demo.MP4", None))
        .await
        .unwrap();

    assert_eq!(reserved.kind, ChannelMediaKind::Video);
    assert_eq!(reserved.content_type, "video/mp4");
    assert_eq!(reserved.attachment_id, Uuid::nil());
    assert_eq!(reserved.upload_url, "https://upload.example.test/put");
    assert_eq!(
        *uploads.store.reserved.lock().unwrap(),
        vec![(
            "macro|user@example.com".to_string(),
            "Demo.MP4".to_string(),
            "video/mp4".to_string()
        )]
    );
}

#[tokio::test]
async fn explicit_content_type_wins() {
    let uploads = ChannelMediaUploads::new(FakeStore::default());

    let reserved = uploads
        .reserve(&owner(), upload("clip", Some("Image/PNG")))
        .await
        .unwrap();

    assert_eq!(reserved.kind, ChannelMediaKind::Image);
    assert_eq!(reserved.content_type, "image/png");
}

#[tokio::test]
async fn rejects_files_that_are_not_media() {
    let uploads = ChannelMediaUploads::new(FakeStore::default());

    for request in [
        upload("report.pdf", None),
        upload("clip.mp4", Some("application/octet-stream")),
    ] {
        let error = uploads.reserve(&owner(), request).await.unwrap_err();
        assert!(matches!(error, ChannelMediaUploadError::Invalid(_)));
    }
    assert!(uploads.store.reserved.lock().unwrap().is_empty());
}

#[tokio::test]
async fn rejects_unknown_extension_without_content_type() {
    let uploads = ChannelMediaUploads::new(FakeStore::default());

    let error = uploads
        .reserve(&owner(), upload("clip.unknownext", None))
        .await
        .unwrap_err();

    assert!(matches!(error, ChannelMediaUploadError::Invalid(_)));
}

#[tokio::test]
async fn rejects_paths_and_empty_names() {
    let uploads = ChannelMediaUploads::new(FakeStore::default());

    for name in ["", "  ", "videos/clip.mp4", "..\\clip.mp4", "clip\n.mp4"] {
        let error = uploads
            .reserve(&owner(), upload(name, None))
            .await
            .unwrap_err();
        assert!(
            matches!(error, ChannelMediaUploadError::Invalid(_)),
            "{name:?}"
        );
    }
}

#[tokio::test]
async fn storage_failure_is_reported() {
    let uploads = ChannelMediaUploads::new(FakeStore {
        fail: true,
        ..FakeStore::default()
    });

    let error = uploads
        .reserve(&owner(), upload("clip.mp4", None))
        .await
        .unwrap_err();

    assert!(matches!(error, ChannelMediaUploadError::Storage(_)));
}
