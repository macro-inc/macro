use crate::util::process_pre_insert::sfs_map::{ImageSource, MAX_IMAGE_SIZE_BYTES, PublicImages};
use bytes::Bytes;
use email_api_client_core::models::EmailApiError;
use email_api_client_core::ports::{
    MailboxAttachmentClient, MailboxMessageClient, ProviderRequestGate, ProviderTokenSource,
};
use email_api_client_core::service::EmailApiClientServiceImpl;
use email_types::email::service::attachment::Attachment;
use email_types::email::service::message::Message;
use std::collections::HashMap;
use std::collections::hash_map::Entry;
use tokio::sync::Mutex;
use url::Url;
use uuid::Uuid;

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
pub(super) struct GmailSignatureImages<'a, R, T, L> {
    email_api: &'a EmailApiClientServiceImpl<R, T, L>,
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

impl<'a, R, T, L> GmailSignatureImages<'a, R, T, L> {
    pub(super) fn new(email_api: &'a EmailApiClientServiceImpl<R, T, L>, link_id: Uuid) -> Self {
        Self {
            email_api,
            link_id,
            reads: Mutex::default(),
        }
    }

    /// The first Gmail read that failed in a way retrying the import may fix
    /// (a rate limit or a transient provider error), which left its image
    /// unresolved without saying the mailbox lacks it.
    pub(super) fn into_retryable_failure(self) -> Option<EmailApiError> {
        self.reads.into_inner().retryable
    }
}

impl<R, T, L> ImageSource for GmailSignatureImages<'_, R, T, L>
where
    R: MailboxMessageClient + MailboxAttachmentClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    async fn fetch(&self, url: &str) -> anyhow::Result<Option<Bytes>> {
        let Some(image) = GmailMessageImage::parse(url) else {
            return PublicImages.fetch(url).await;
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

impl<R, T, L> GmailSignatureImages<'_, R, T, L>
where
    R: MailboxMessageClient + MailboxAttachmentClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    #[tracing::instrument(
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
    ) -> Result<Option<Bytes>, EmailApiError> {
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
            .email_api
            .get_attachment(self.link_id, &part.message_id, attachment_id)
            .await?;
        span.record("outcome", "resolved");
        Ok(Some(Bytes::from(data)))
    }

    async fn read_parts(
        &self,
        location: &ImageLocation,
    ) -> Result<Option<Vec<ImagePart>>, EmailApiError> {
        let messages = match location {
            ImageLocation::Message(id) => self.read_message(id).await?,
            ImageLocation::Thread(id) => match self.email_api.get_thread(self.link_id, id).await {
                Ok(thread) => Some(thread.into_iter().map(|message| message.message).collect()),
                Err(EmailApiError::NotFound) => self.read_message(id).await?,
                Err(error) => return Err(error),
            },
        };
        Ok(messages.map(|messages| messages.into_iter().flat_map(image_parts).collect()))
    }

    async fn read_message(&self, id: &str) -> Result<Option<Vec<Message>>, EmailApiError> {
        Ok(self
            .email_api
            .get_message(self.link_id, id)
            .await?
            .map(|message| vec![message.message]))
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
