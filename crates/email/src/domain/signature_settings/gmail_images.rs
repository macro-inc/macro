//! Image selection and read policy for one signature import.
use email_api_client::domain::models::EmailApiError;
use models_email::email::service::attachment::Attachment;
use models_email::email::service::message::Message;
use std::collections::HashMap;
use std::collections::hash_map::Entry;
use tokio::sync::Mutex;
use url::Url;
use uuid::Uuid;

/// Maximum size of an image that signature import will read.
pub const MAX_IMAGE_SIZE_BYTES: usize = 10 * 1024 * 1024;

/// Reads bytes for rehosting and identifies publicly shareable sources.
pub trait SignatureImageSource: Sync {
    /// Read a selected image, or return no bytes when it is unavailable.
    fn fetch(&self, url: &str) -> impl Future<Output = anyhow::Result<Option<Vec<u8>>>> + Send;
    /// Whether a copy can enter the shared URL-to-file mapping.
    fn is_public(&self, url: &str) -> bool;
}

/// Provider and public image reads needed by a signature import.
pub trait SignatureImageReader: Send + Sync {
    /// Read a public image without mailbox credentials.
    fn public_image(
        &self,
        url: &str,
    ) -> impl Future<Output = anyhow::Result<Option<Vec<u8>>>> + Send;
    /// Read one message from the selected mailbox.
    fn get_message(
        &self,
        link: Uuid,
        id: &str,
    ) -> impl Future<Output = Result<Option<Message>, EmailApiError>> + Send;
    /// Read a thread from the selected mailbox.
    fn get_thread(
        &self,
        link: Uuid,
        id: &str,
    ) -> impl Future<Output = Result<Vec<Message>, EmailApiError>> + Send;
    /// Read one attachment from the selected mailbox.
    fn get_attachment(
        &self,
        link: Uuid,
        message: &str,
        attachment: &str,
    ) -> impl Future<Output = Result<Vec<u8>, EmailApiError>> + Send;
}

/// Public-only image source used when patching settings.
pub struct PublicSignatureImages<'a, R>(pub &'a R);

impl<R: SignatureImageReader> SignatureImageSource for PublicSignatureImages<'_, R> {
    async fn fetch(&self, url: &str) -> anyhow::Result<Option<Vec<u8>>> {
        self.0.public_image(url).await
    }
    fn is_public(&self, _: &str) -> bool {
        true
    }
}

/// An image pasted into a Gmail signature from a message. Gmail keeps it as a
/// `mail.google.com/mail/u/<n>?...&view=fimg&disp=emb&realattid=...` URL, which
/// loads only in that mailbox's browser session, never for a recipient.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct GmailMessageImage {
    location: ImageLocation,
    /// The image part's Content-ID, without angle brackets.
    content_id: String,
}

/// The Gmail API read that finds the message holding an image.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum ImageLocation {
    /// `permmsgid=msg-f:<decimal>` is the message's Gmail id, which the API
    /// spells in hex.
    Message(String),
    /// Without it (messages the mailbox sent carry `msg-a:` ids) `th` names
    /// the thread, or in older URLs the message itself.
    Thread(String),
}

impl GmailMessageImage {
    /// Reads where a Gmail-embedded image URL points, or `None` for any other
    /// URL.
    pub(super) fn parse(url: &str) -> Option<Self> {
        let url = Url::parse(url).ok()?;
        if url.scheme() != "https"
            || url.host_str() != Some("mail.google.com")
            || !url.path().starts_with("/mail/")
        {
            return None;
        }

        let mut message_id = None;
        let mut thread_id = None;
        let mut content_id = None;
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "permmsgid" => {
                    if let Some(id) = value
                        .strip_prefix("msg-f:")
                        .and_then(|id| id.parse::<u64>().ok())
                    {
                        message_id = Some(format!("{id:x}"));
                    }
                }
                "th" => thread_id = Some(value.into_owned()),
                "realattid" => content_id = Some(value.into_owned()),
                _ => {}
            }
        }

        let content_id = content_id.filter(|id| !id.is_empty())?;
        // The id goes into a Gmail API path, so it must be the hex id Gmail uses.
        let thread_id =
            thread_id.filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit()));
        let location = match (message_id, thread_id) {
            (Some(id), _) => ImageLocation::Message(id),
            (None, Some(id)) => ImageLocation::Thread(id),
            (None, None) => return None,
        };

        Some(Self {
            location,
            content_id,
        })
    }

    fn is_part(&self, attachment: &Attachment) -> bool {
        attachment.content_id.as_deref().is_some_and(|header| {
            header.trim().trim_start_matches('<').trim_end_matches('>') == self.content_id
        })
    }
}

/// Signature images for one Gmail inbox: images embedded from that mailbox's
/// own messages are read through the Gmail API, everything else over public
/// HTTP.
pub struct GmailSignatureImages<'a, R> {
    reader: &'a R,
    link_id: Uuid,
    /// Held across each Gmail read, so a signature's images take one of the
    /// mailbox's live request slots at a time; backfill can hold the rest.
    reads: Mutex<Reads>,
}

#[derive(Default)]
struct Reads {
    /// The parts of what each location held, `None` when the mailbox has no
    /// such message. A signature's images usually come from one message.
    parts: HashMap<ImageLocation, Option<Vec<ImagePart>>>,
    /// The first read that failed in a way retrying the import may fix.
    retryable: Option<EmailApiError>,
}

struct ImagePart {
    message_id: String,
    attachment: Attachment,
}

impl<'a, R> GmailSignatureImages<'a, R> {
    /// Start an image read session for this mailbox.
    pub fn new(reader: &'a R, link_id: Uuid) -> Self {
        Self {
            reader,
            link_id,
            reads: Mutex::default(),
        }
    }

    /// The first Gmail read that failed in a way retrying the import may fix
    /// (a rate limit or a transient provider error), which left its image
    /// unresolved without saying the mailbox lacks it.
    pub fn into_retryable_failure(self) -> Option<EmailApiError> {
        self.reads.into_inner().retryable
    }
}

impl<R: SignatureImageReader> SignatureImageSource for GmailSignatureImages<'_, R> {
    async fn fetch(&self, url: &str) -> anyhow::Result<Option<Vec<u8>>> {
        let Some(image) = GmailMessageImage::parse(url) else {
            return self.reader.public_image(url).await;
        };
        let mut reads = self.reads.lock().await;
        // The import answers "try again" once one read failed that way, so
        // further reads would only wait out the mailbox's cooldown.
        if reads.retryable.is_some() {
            return Ok(None);
        }
        let result = self.read_image(&mut reads.parts, &image).await;
        if let Err(error) = &result
            && error.is_transient()
            && reads.retryable.is_none()
        {
            reads.retryable = Some(error.clone());
        }
        Ok(result?)
    }

    fn is_public(&self, url: &str) -> bool {
        GmailMessageImage::parse(url).is_none()
    }
}

impl<R: SignatureImageReader> GmailSignatureImages<'_, R> {
    #[tracing::instrument(
        target = "email_service::api::email::settings::import_signature::gmail_images",
        skip(self, parts, image),
        fields(
            link_id = %self.link_id,
            location = ?image.location,
            outcome = tracing::field::Empty,
        ),
        err(level = "warn")
    )]
    async fn read_image(
        &self,
        parts: &mut HashMap<ImageLocation, Option<Vec<ImagePart>>>,
        image: &GmailMessageImage,
    ) -> Result<Option<Vec<u8>>, EmailApiError> {
        let span = tracing::Span::current();
        let held = match parts.entry(image.location.clone()) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => entry.insert(self.read_parts(&image.location).await?),
        };
        let Some(held) = held else {
            span.record("outcome", "message_missing");
            return Ok(None);
        };
        let Some((part, attachment_id)) = held.iter().find_map(|part| {
            image
                .is_part(&part.attachment)
                .then_some(part.attachment.provider_id.as_deref())
                .flatten()
                .map(|attachment_id| (part, attachment_id))
        }) else {
            span.record("outcome", "part_missing");
            return Ok(None);
        };
        if part
            .attachment
            .size_bytes
            .is_some_and(|size| size > MAX_IMAGE_SIZE_BYTES as i64)
        {
            span.record("outcome", "too_large");
            return Ok(None);
        }

        let data = self
            .reader
            .get_attachment(self.link_id, &part.message_id, attachment_id)
            .await?;
        span.record("outcome", "resolved");
        Ok(Some(data))
    }

    async fn read_parts(
        &self,
        location: &ImageLocation,
    ) -> Result<Option<Vec<ImagePart>>, EmailApiError> {
        let messages = match location {
            ImageLocation::Message(id) => self.read_message(id).await?,
            ImageLocation::Thread(id) => match self.reader.get_thread(self.link_id, id).await {
                Ok(thread) => Some(thread),
                Err(EmailApiError::NotFound) => self.read_message(id).await?,
                Err(error) => return Err(error),
            },
        };
        Ok(messages.map(|messages| messages.into_iter().flat_map(image_parts).collect()))
    }

    async fn read_message(&self, id: &str) -> Result<Option<Vec<Message>>, EmailApiError> {
        Ok(self
            .reader
            .get_message(self.link_id, id)
            .await?
            .map(|message| vec![message]))
    }
}

fn image_parts(message: Message) -> Vec<ImagePart> {
    let Some(message_id) = message.provider_id else {
        return Vec::new();
    };
    message
        .attachments
        .into_iter()
        .map(|attachment| ImagePart {
            message_id: message_id.clone(),
            attachment,
        })
        .collect()
}

#[cfg(test)]
mod test;
