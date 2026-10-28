//! Turns attached images into short phrases a text-only judge can read.

#[cfg(test)]
mod test;

use std::sync::Arc;
use std::time::Duration;

use agent::PredefinedModel;
use ai_usage::{UsageContext, UsageRecorder};
use async_trait::async_trait;
use messages::domain::events::MessageEventAttachment;
use static_file::domain::ports::StaticFileRepo;

/// Channel attachment entity type for an image stored as a static file.
const STATIC_IMAGE: &str = "static/image";

/// How many images get a model description. Further images are still marked,
/// so the judge can tell they exist, without a vision call per picture.
const MAX_DESCRIBED_IMAGES: usize = 8;

/// Bound on one description, download included, so a stuck file cannot hold
/// the trigger consumer.
const CAPTION_TIMEOUT: Duration = Duration::from_secs(8);

/// Longest phrase kept from a caption. A rambling answer would crowd out the
/// message the judge is actually scoring.
const MAX_PHRASE_CHARS: usize = 160;

const CAPTION_SYSTEM: &str = "\
Reply with only a short noun phrase describing the image, as if finishing \
\"this is an image of\". Examples: \"a frog\", \"a screenshot of a compiler \
error\". No sentence, no quotes, no trailing punctuation.";

const CAPTION_INSTRUCTION: &str = "Describe this image.";

/// Describes one static-file image as a short noun phrase, such as "a frog".
///
/// `None` means the picture could not be described. Callers still tell the
/// judge that an image was attached.
#[async_trait]
pub trait ImageCaptioner: Send + Sync {
    /// A short noun phrase for `file_id`, or `None` when it cannot be described.
    async fn caption(&self, file_id: &str, ctx: UsageContext) -> Option<String>;
}

/// Captions images with the fast model after downloading them from static files.
pub struct VisionImageCaptioner<F> {
    files: F,
    model: PredefinedModel,
    recorder: Arc<dyn UsageRecorder>,
}

impl<F> VisionImageCaptioner<F> {
    /// Caption images read through `files`, billing `recorder`.
    pub fn new(files: F, recorder: Arc<dyn UsageRecorder>) -> Self {
        Self {
            files,
            model: PredefinedModel::Fast,
            recorder,
        }
    }
}

#[async_trait]
impl<F> ImageCaptioner for VisionImageCaptioner<F>
where
    F: StaticFileRepo,
{
    async fn caption(&self, file_id: &str, ctx: UsageContext) -> Option<String> {
        let bytes = match self.files.read(file_id).await {
            Ok(bytes) => bytes,
            Err(error) => {
                tracing::warn!(error = ?error, file_id, "failed to read an attached image");
                return None;
            }
        };
        match agent::complete_about_image(
            self.model,
            CAPTION_SYSTEM,
            CAPTION_INSTRUCTION,
            bytes,
            self.recorder.as_ref(),
            ctx,
        )
        .await
        {
            Ok(raw) => normalize_caption(&raw),
            Err(error) => {
                tracing::warn!(error = ?error, file_id, "failed to describe an attached image");
                None
            }
        }
    }
}

/// Blurbs for the image attachments on a message, in attachment order.
///
/// Each described image becomes `<this is an image of a frog>`. An image that
/// cannot be described, or that is past [`MAX_DESCRIBED_IMAGES`], becomes
/// `<this is an image>`.
pub(crate) async fn blurbs_for_attachments(
    captioner: &dyn ImageCaptioner,
    attachments: &[MessageEventAttachment],
    ctx: UsageContext,
) -> Vec<String> {
    let image_ids: Vec<&str> = attachments
        .iter()
        .filter(|attachment| attachment.entity_type == STATIC_IMAGE)
        .map(|attachment| attachment.entity_id.as_str())
        .collect();

    let mut blurbs = Vec::with_capacity(image_ids.len());
    for (index, file_id) in image_ids.iter().copied().enumerate() {
        if index >= MAX_DESCRIBED_IMAGES {
            blurbs.push(image_blurb(None));
            continue;
        }
        let phrase =
            match tokio::time::timeout(CAPTION_TIMEOUT, captioner.caption(file_id, ctx.clone()))
                .await
            {
                Ok(phrase) => phrase,
                Err(_elapsed) => {
                    tracing::warn!(file_id, "image caption timed out");
                    None
                }
            };
        blurbs.push(image_blurb(phrase.as_deref()));
    }
    blurbs
}

/// `<this is an image of {phrase}>`, or `<this is an image>` when there is no phrase.
pub(crate) fn image_blurb(phrase: Option<&str>) -> String {
    match phrase.map(str::trim).filter(|phrase| !phrase.is_empty()) {
        Some(phrase) => format!("<this is an image of {phrase}>"),
        None => "<this is an image>".to_owned(),
    }
}

/// Append image blurbs to message text. An image-only message is just the blurbs.
pub(crate) fn append_image_blurbs(content: &str, blurbs: &[String]) -> String {
    if blurbs.is_empty() {
        return content.to_owned();
    }
    let blurbs = blurbs.join("\n");
    if content.trim().is_empty() {
        blurbs
    } else {
        format!("{}\n{blurbs}", content.trim_end())
    }
}

/// The first line of a caption, reduced to the noun phrase the blurb wraps.
pub(crate) fn normalize_caption(raw: &str) -> Option<String> {
    let mut phrase = raw.lines().next()?.trim().to_owned();
    phrase = strip_wrapping_quotes(&phrase).to_owned();
    for prefix in ["this is an image of ", "an image of ", "image of "] {
        if let Some(rest) = strip_prefix_ignore_ascii_case(&phrase, prefix) {
            phrase = rest.to_owned();
            break;
        }
    }
    phrase.retain(|ch| ch != '<' && ch != '>');
    let phrase = phrase
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches(['.', '!', '?', ',', ';', ':'])
        .trim()
        .to_owned();
    if phrase.is_empty() {
        return None;
    }
    let phrase = phrase.chars().take(MAX_PHRASE_CHARS).collect::<String>();
    let phrase = phrase.trim_end().to_owned();
    if phrase.is_empty() {
        None
    } else {
        Some(phrase)
    }
}

fn strip_wrapping_quotes(phrase: &str) -> &str {
    let mut chars = phrase.chars();
    let (Some(open), Some(close)) = (chars.next(), chars.next_back()) else {
        return phrase;
    };
    if (open == '"' && close == '"') || (open == '\'' && close == '\'') {
        phrase[open.len_utf8()..phrase.len() - close.len_utf8()].trim()
    } else {
        phrase
    }
}

fn strip_prefix_ignore_ascii_case<'a>(phrase: &'a str, prefix: &str) -> Option<&'a str> {
    let rest = phrase.get(prefix.len()..)?;
    if phrase[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(rest.trim())
    } else {
        None
    }
}
