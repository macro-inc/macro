use crate::util::process_pre_insert::sfs_map::{ImageSource, MAX_IMAGE_SIZE_BYTES, PublicImages};
use bytes::Bytes;
use email_api_client::domain::ports::{
    MailboxAttachmentClient, MailboxMessageClient, ProviderRequestGate, ProviderTokenSource,
};
use email_api_client::domain::service::EmailApiClientServiceImpl;
use models_email::email::service::attachment::Attachment;
use url::Url;
use uuid::Uuid;

/// An image pasted into a Gmail signature from a message. Gmail keeps it as a
/// `mail.google.com/mail/u/<n>?...&view=fimg&disp=emb&realattid=...` URL, which
/// loads only in that mailbox's browser session, never for a recipient.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct GmailMessageImage {
    /// Gmail API id of the message holding the image.
    message_id: String,
    /// The image part's Content-ID, without angle brackets.
    content_id: String,
}

impl GmailMessageImage {
    /// Reads the message and image part a Gmail-embedded image URL points at,
    /// or `None` for any other URL.
    pub(super) fn parse(url: &str) -> Option<Self> {
        let url = Url::parse(url).ok()?;
        if url.scheme() != "https"
            || url.host_str() != Some("mail.google.com")
            || !url.path().starts_with("/mail/")
        {
            return None;
        }

        let mut permanent_id = None;
        let mut thread_param = None;
        let mut content_id = None;
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                // `msg-f:<decimal>` is the message's Gmail id; the API spells it in hex.
                "permmsgid" => {
                    if let Some(id) = value
                        .strip_prefix("msg-f:")
                        .and_then(|id| id.parse::<u64>().ok())
                    {
                        permanent_id = Some(format!("{id:x}"));
                    }
                }
                // Older URLs name the message in `th` instead.
                "th" => thread_param = Some(value.into_owned()),
                "realattid" => content_id = Some(value.into_owned()),
                _ => {}
            }
        }

        // The id goes into a Gmail API path, so it must be the hex id Gmail uses.
        let message_id = permanent_id
            .or(thread_param)
            .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit()))?;
        let content_id = content_id.filter(|id| !id.is_empty())?;

        Some(Self {
            message_id,
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
/// HTTP. Only this inbox's mailbox is readable, so an image from another
/// account stays unresolved.
pub(super) struct GmailSignatureImages<'a, R, T, L> {
    pub(super) email_api: &'a EmailApiClientServiceImpl<R, T, L>,
    pub(super) link_id: Uuid,
}

impl<R, T, L> ImageSource for GmailSignatureImages<'_, R, T, L>
where
    R: MailboxMessageClient + MailboxAttachmentClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    async fn fetch(&self, url: &str) -> anyhow::Result<Option<Bytes>> {
        match GmailMessageImage::parse(url) {
            Some(image) => self.fetch_message_image(&image).await,
            None => PublicImages.fetch(url).await,
        }
    }
}

impl<R, T, L> GmailSignatureImages<'_, R, T, L>
where
    R: MailboxMessageClient + MailboxAttachmentClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    #[tracing::instrument(
        skip(self, image),
        fields(link_id = %self.link_id, outcome = tracing::field::Empty),
        err
    )]
    async fn fetch_message_image(
        &self,
        image: &GmailMessageImage,
    ) -> anyhow::Result<Option<Bytes>> {
        let span = tracing::Span::current();
        let Some(message) = self
            .email_api
            .get_message(self.link_id, &image.message_id)
            .await?
        else {
            span.record("outcome", "message_missing");
            return Ok(None);
        };

        let Some(part) = message
            .message
            .attachments
            .iter()
            .find(|attachment| image.is_part(attachment))
        else {
            span.record("outcome", "part_missing");
            return Ok(None);
        };
        let Some(attachment_id) = part.provider_id.as_deref() else {
            span.record("outcome", "part_missing");
            return Ok(None);
        };
        if part
            .size_bytes
            .is_some_and(|size| size > MAX_IMAGE_SIZE_BYTES as i64)
        {
            span.record("outcome", "too_large");
            return Ok(None);
        }

        let data = self
            .email_api
            .get_attachment(self.link_id, &image.message_id, attachment_id)
            .await?;
        span.record("outcome", "resolved");
        Ok(Some(Bytes::from(data)))
    }
}

#[cfg(test)]
mod test;
