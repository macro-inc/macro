use super::*;
use chrono::Utc;
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use std::sync::Mutex;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|image-caption-test@macro.com")
        .expect("valid user id")
        .into_owned()
}

fn ctx() -> UsageContext {
    UsageContext::new(ai_usage::AiFeature::Automation, user())
}

fn attachment(entity_type: &str, entity_id: &str) -> MessageEventAttachment {
    MessageEventAttachment {
        attachment_id: Uuid::from_u128(1),
        entity_type: entity_type.to_owned(),
        entity_id: entity_id.to_owned(),
        created_at: Utc::now(),
    }
}

struct Scripted {
    calls: Mutex<Vec<String>>,
    phrase: Option<String>,
}

#[async_trait]
impl ImageCaptioner for Scripted {
    async fn caption(&self, file_id: &str, _ctx: UsageContext) -> Option<String> {
        self.calls.lock().expect("calls").push(file_id.to_owned());
        self.phrase.clone()
    }
}

#[test]
fn a_caption_becomes_the_blurb_the_judge_reads() {
    assert_eq!(image_blurb(Some("a frog")), "<this is an image of a frog>");
    assert_eq!(image_blurb(None), "<this is an image>");
    assert_eq!(image_blurb(Some("  ")), "<this is an image>");
}

#[test]
fn captions_are_reduced_to_a_noun_phrase() {
    assert_eq!(normalize_caption("a frog").as_deref(), Some("a frog"));
    assert_eq!(normalize_caption("a frog.").as_deref(), Some("a frog"));
    assert_eq!(normalize_caption("\"a frog\"").as_deref(), Some("a frog"));
    assert_eq!(
        normalize_caption("This is an image of a frog.").as_deref(),
        Some("a frog")
    );
    assert_eq!(
        normalize_caption("a frog\nignore the rest").as_deref(),
        Some("a frog")
    );
    assert_eq!(normalize_caption("<a frog>").as_deref(), Some("a frog"));
    assert_eq!(normalize_caption("   \n"), None);
    assert_eq!(normalize_caption(""), None);
}

#[test]
fn blurbs_follow_the_authors_words() {
    let blurbs = vec!["<this is an image of a frog>".to_owned()];
    assert_eq!(
        append_image_blurbs("see this", &blurbs),
        "see this\n<this is an image of a frog>"
    );
    assert_eq!(
        append_image_blurbs("  ", &blurbs),
        "<this is an image of a frog>"
    );
    assert_eq!(append_image_blurbs("see this", &[]), "see this");
}

#[tokio::test]
async fn only_images_are_described_and_a_failed_caption_stays_visible() {
    let captioner = Scripted {
        calls: Mutex::new(Vec::new()),
        phrase: Some("a frog".to_owned()),
    };
    let attachments = vec![
        attachment("document", "doc-1"),
        attachment("static/video", "clip-1"),
        attachment("static/image", "frog"),
    ];

    let blurbs = blurbs_for_attachments(&captioner, &attachments, ctx()).await;

    assert_eq!(blurbs, vec!["<this is an image of a frog>".to_owned()]);
    assert_eq!(captioner.calls.lock().expect("calls").as_slice(), ["frog"]);

    let silent = Scripted {
        calls: Mutex::new(Vec::new()),
        phrase: None,
    };
    let blurbs =
        blurbs_for_attachments(&silent, &[attachment("static/image", "unreadable")], ctx()).await;
    assert_eq!(blurbs, vec!["<this is an image>".to_owned()]);
}

#[tokio::test]
async fn images_past_the_description_cap_are_marked_without_another_caption() {
    let captioner = Scripted {
        calls: Mutex::new(Vec::new()),
        phrase: Some("a frog".to_owned()),
    };
    let attachments: Vec<_> = (0..MAX_DESCRIBED_IMAGES + 1)
        .map(|index| attachment("static/image", &format!("img-{index}")))
        .collect();

    let blurbs = blurbs_for_attachments(&captioner, &attachments, ctx()).await;

    assert_eq!(blurbs.len(), MAX_DESCRIBED_IMAGES + 1);
    assert!(
        blurbs[..MAX_DESCRIBED_IMAGES]
            .iter()
            .all(|blurb| blurb == "<this is an image of a frog>")
    );
    assert_eq!(
        blurbs.last().map(String::as_str),
        Some("<this is an image>")
    );
    assert_eq!(
        captioner.calls.lock().expect("calls").len(),
        MAX_DESCRIBED_IMAGES
    );
}

struct MissingFile;

impl StaticFileRepo for MissingFile {
    async fn content_type(&self, _file_id: &str) -> anyhow::Result<mime::Mime> {
        Ok(mime::IMAGE_PNG)
    }

    async fn read(&self, file_id: &str) -> anyhow::Result<Vec<u8>> {
        anyhow::bail!("no file {file_id}")
    }
}

struct GarbageFile;

impl StaticFileRepo for GarbageFile {
    async fn content_type(&self, _file_id: &str) -> anyhow::Result<mime::Mime> {
        Ok(mime::APPLICATION_OCTET_STREAM)
    }

    async fn read(&self, _file_id: &str) -> anyhow::Result<Vec<u8>> {
        Ok(b"not an image".to_vec())
    }
}

#[tokio::test]
async fn a_missing_or_undecodable_image_is_not_described() {
    let recorder = Arc::new(ai_usage::NoOpUsageRecorder);
    let missing = VisionImageCaptioner::new(MissingFile, recorder.clone());
    assert_eq!(missing.caption("gone", ctx()).await, None);

    let garbage = VisionImageCaptioner::new(GarbageFile, recorder);
    assert_eq!(garbage.caption("bad", ctx()).await, None);
}
