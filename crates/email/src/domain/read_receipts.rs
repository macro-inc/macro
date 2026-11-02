//! Sender-opted-in open tracking: a per-message pixel added at provider delivery.
//!
//! Opens are approximate. Image proxies and privacy features fetch pixels on
//! delivery, and clients that block images never fetch them.

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};
use lol_html::{HtmlRewriter, Settings, element};
use macro_user_id::user_id::MacroUserIdStr;
use rand::RngCore;
use rootcause::Report;
use std::future::Future;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Path of the public pixel route, relative to the email service base URL.
pub const PIXEL_PATH: &str = "/opens/";
/// Repeat fetches inside this window count as one open; clients often load an image twice.
const OPEN_DEBOUNCE_SECS: i64 = 5;
/// Upper bound on receipts returned for one thread.
pub const MAX_THREAD_RECEIPTS: i64 = 200;
const TOKEN_BYTES: usize = 32;
/// Base64url without padding of [`TOKEN_BYTES`].
const TOKEN_LEN: usize = 43;

/// Unguessable pixel token: URL-path-safe base64url without padding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadReceiptToken(String);

impl ReadReceiptToken {
    /// A fresh random token.
    pub fn generate() -> Self {
        use base64::Engine;
        let mut bytes = [0_u8; TOKEN_BYTES];
        rand::rng().fill_bytes(&mut bytes);
        Self(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
    }

    /// Accept only the shape [`Self::generate`] produces.
    pub fn parse(raw: &str) -> Option<Self> {
        (raw.len() == TOKEN_LEN
            && raw
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
        .then(|| Self(raw.to_owned()))
    }

    /// The token as stored and embedded in the pixel URL.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Absolute URL every Macro pixel starts with, e.g. `https://gateway.macro.com/email/opens/`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PixelUrlPrefix(String);

impl PixelUrlPrefix {
    /// Build from the email service's public base URL.
    pub fn new(email_service_base: &str) -> Self {
        Self(format!(
            "{}{PIXEL_PATH}",
            email_service_base.trim_end_matches('/')
        ))
    }

    /// The prefix as a string, for clients that hide Macro's own pixels.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn url(&self, token: &ReadReceiptToken) -> String {
        format!("{}{}", self.0, token.as_str())
    }
}

/// Open state of one tracked, sent message.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct MessageReadReceipt {
    /// The tracked message.
    pub message_id: Uuid,
    /// Counted pixel fetches.
    pub open_count: u32,
    /// First counted fetch.
    pub first_opened_at: Option<DateTime<Utc>>,
    /// Latest counted fetch.
    pub last_opened_at: Option<DateTime<Utc>>,
}

/// Failures of the thread read path.
#[derive(Debug, thiserror::Error)]
pub enum ReadReceiptError {
    /// The receipt carries no user identity.
    #[error("authentication required")]
    Unauthorized,
    /// Persistence failed.
    #[error("internal error")]
    Internal(Report),
}

impl From<Report> for ReadReceiptError {
    fn from(report: Report) -> Self {
        Self::Internal(report)
    }
}

/// Persisted facts for open tracking.
pub trait ReadReceiptRepository: Send + Sync + 'static {
    /// Whether the inbox opted in; a missing settings row means no.
    fn tracking_enabled(&self, link_id: Uuid) -> impl Future<Output = Result<bool, Report>> + Send;
    /// Store `candidate` unless the message already has a token; return the stored token.
    fn message_token(
        &self,
        message_id: Uuid,
        candidate: &ReadReceiptToken,
    ) -> impl Future<Output = Result<ReadReceiptToken, Report>> + Send;
    /// Count an open at `at` for a sent message, unless its last counted open is
    /// after `debounce_after`. Returns whether an open was counted.
    fn record_open(
        &self,
        token: &ReadReceiptToken,
        at: DateTime<Utc>,
        debounce_after: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
    /// The user's own and delegated inboxes.
    fn accessible_inboxes(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;
    /// Receipts of sent messages in the thread that belong to `link_ids`, newest first.
    fn thread_receipts(
        &self,
        thread_id: Uuid,
        link_ids: &[Uuid],
        limit: i64,
    ) -> impl Future<Output = Result<Vec<MessageReadReceipt>, Report>> + Send;
}

/// Open tracking policy shared by every delivery path and the read API.
#[derive(Debug, Clone)]
pub struct ReadReceiptService<R> {
    repo: R,
    prefix: PixelUrlPrefix,
}

impl<R: ReadReceiptRepository> ReadReceiptService<R> {
    /// Construct with the repository adapter and the public pixel URL prefix.
    pub fn new(repo: R, prefix: PixelUrlPrefix) -> Self {
        Self { repo, prefix }
    }

    /// The HTML body to hand the provider. Macro pixels quoted from earlier
    /// messages are always removed so a reply never reports opens of its
    /// ancestors. When the inbox opted in, this message's pixel is appended.
    /// Plain-text-only messages are not tracked, and tracking failures never
    /// block delivery.
    #[tracing::instrument(skip(self, html), fields(tracked = tracing::field::Empty))]
    pub async fn tracked_html(
        &self,
        link_id: Uuid,
        message_id: Uuid,
        html: Option<&str>,
    ) -> Option<String> {
        let stripped = self.untracked_html(html)?;
        let token = async {
            if !self.repo.tracking_enabled(link_id).await? {
                return Ok(None);
            }
            self.repo
                .message_token(message_id, &ReadReceiptToken::generate())
                .await
                .map(Some)
        }
        .await
        .inspect_err(|error: &Report| {
            tracing::warn!(error = ?error, "read receipt unavailable; sending untracked");
        })
        .ok()
        .flatten();
        tracing::Span::current().record("tracked", token.is_some());
        Some(match token {
            Some(token) => append_pixel(&stripped, &self.prefix.url(&token)),
            None => stripped,
        })
    }

    /// The HTML body with any Macro pixel removed, for drafts that are not being sent.
    pub fn untracked_html(&self, html: Option<&str>) -> Option<String> {
        html.map(|html| strip_pixels(html, &self.prefix))
    }

    /// Count a pixel fetch. Malformed, unknown, and unsent tokens are ignored
    /// so the public route reveals nothing about the token.
    #[tracing::instrument(skip_all, fields(counted = tracing::field::Empty), err)]
    pub async fn record_open(&self, raw_token: &str) -> Result<(), Report> {
        let Some(token) = ReadReceiptToken::parse(raw_token) else {
            return Ok(());
        };
        let now = Utc::now();
        let counted = self
            .repo
            .record_open(
                &token,
                now,
                now - chrono::Duration::seconds(OPEN_DEBOUNCE_SECS),
            )
            .await?;
        tracing::Span::current().record("counted", counted);
        Ok(())
    }

    /// Receipts for an authorized thread, limited to inboxes the viewer owns or
    /// was delegated. People the thread was shared with never see when its
    /// recipients opened it.
    #[tracing::instrument(skip_all, err)]
    pub async fn thread_receipts(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<MessageReadReceipt>, ReadReceiptError> {
        if receipt.entity().entity_type != EntityType::EmailThread {
            return Err(ReadReceiptError::Unauthorized);
        }
        let viewer = receipt
            .acting_user_id()
            .ok_or(ReadReceiptError::Unauthorized)?;
        let thread_id = Uuid::parse_str(&receipt.entity().entity_id)
            .map_err(|error| rootcause::report!("invalid thread id: {error}"))?;
        let inboxes = self.repo.accessible_inboxes(viewer).await?;
        if inboxes.is_empty() {
            return Ok(Vec::new());
        }
        Ok(self
            .repo
            .thread_receipts(thread_id, &inboxes, MAX_THREAD_RECEIPTS)
            .await?)
    }
}

fn pixel_tag(url: &str) -> String {
    format!(
        r#"<img src="{url}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0" />"#
    )
}

/// Insert the pixel before the closing `</body>`, or append it to a fragment.
pub(crate) fn append_pixel(html: &str, url: &str) -> String {
    let pixel = pixel_tag(url);
    match html.to_ascii_lowercase().rfind("</body>") {
        Some(at) => format!("{}{pixel}{}", &html[..at], &html[at..]),
        None => format!("{html}{pixel}"),
    }
}

/// Remove every `<img>` whose source is a Macro pixel; any other content is untouched.
pub(crate) fn strip_pixels(html: &str, prefix: &PixelUrlPrefix) -> String {
    if !html.contains(prefix.as_str()) {
        return html.to_owned();
    }
    let selector = format!(r#"img[src^="{}"]"#, prefix.as_str());
    let mut output = Vec::with_capacity(html.len());
    let mut rewriter = HtmlRewriter::new(
        Settings {
            element_content_handlers: vec![element!(selector.as_str(), |el| {
                el.remove();
                Ok(())
            })],
            ..Settings::default()
        },
        |chunk: &[u8]| output.extend_from_slice(chunk),
    );
    if rewriter.write(html.as_bytes()).is_err() || rewriter.end().is_err() {
        return html.to_owned();
    }
    String::from_utf8(output).unwrap_or_else(|_| html.to_owned())
}

#[cfg(feature = "mailbox")]
mod outlook {
    use super::{ReadReceiptRepository, ReadReceiptService};
    use crate::domain::mailbox::MailboxError;
    use crate::domain::mailbox::drafts::models::{DraftFile, DraftLease, PreparedDraft};
    use crate::domain::mailbox::drafts::ports::DraftMaterializer;

    /// Adds the read receipt pixel to Outlook drafts that are scheduled to send.
    /// A checkpoint freezes the prepared body per revision and the token is
    /// stable per message, so draft revisions rebuild the same body.
    pub struct ReadReceiptMaterializer<M, R> {
        inner: M,
        receipts: ReadReceiptService<R>,
    }

    impl<M, R> ReadReceiptMaterializer<M, R> {
        /// Wrap the content materializer.
        pub fn new(inner: M, receipts: ReadReceiptService<R>) -> Self {
            Self { inner, receipts }
        }
    }

    impl<M: DraftMaterializer, R: ReadReceiptRepository> DraftMaterializer
        for ReadReceiptMaterializer<M, R>
    {
        async fn prepare_draft(&self, lease: &DraftLease) -> Result<PreparedDraft, MailboxError> {
            let mut prepared = self.inner.prepare_draft(lease).await?;
            if lease.delete_requested {
                return Ok(prepared);
            }
            let message = &mut prepared.request.message;
            message.body_html = if lease.input.send_time.is_some() {
                self.receipts
                    .tracked_html(
                        lease.mailbox.link_id,
                        lease.message_id,
                        message.body_html.as_deref(),
                    )
                    .await
            } else {
                self.receipts.untracked_html(message.body_html.as_deref())
            };
            Ok(prepared)
        }

        async fn draft_file_bytes(
            &self,
            lease: &DraftLease,
            file: &DraftFile,
        ) -> Result<Vec<u8>, MailboxError> {
            self.inner.draft_file_bytes(lease, file).await
        }
    }
}

#[cfg(feature = "mailbox")]
pub use outlook::ReadReceiptMaterializer;
