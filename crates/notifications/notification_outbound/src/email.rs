//! Email notification adapter.

#[cfg(test)]
mod test;

use aws_sdk_sesv2::types::{
    Body, Content, Destination, EmailContent as SesEmailContent, Message, MessageTag,
};
use hmac::Hmac;
use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sha2::Sha256;
use std::fmt::Write;
use url::Url;

use notification::domain::models::queue_message::EmailContent;
use notification::domain::models::signing::sign_unsubscribe_placeholders;
use notification::domain::ports::EmailSender;

/// Longest sender name shown before the "via Macro" suffix.
const FROM_NAME_MAX_CHARS: usize = 64;

/// Marks a display name as someone Macro sends for, so it never reads as Macro's own mail.
const FROM_NAME_SUFFIX: &str = " (via Macro)";

/// RFC 2047 caps an encoded word at 75 characters; `=?UTF-8?Q?` and `?=` take 12 of them.
const ENCODED_WORD_MAX_TEXT_LEN: usize = 63;

/// The SES message tag that names the notification type on delivery events.
const NOTIFICATION_TYPE_TAG: &str = "notification_type";

/// SES caps message tag values at 256 characters.
const TAG_VALUE_MAX_LEN: usize = 256;

/// Email notification adapter.
///
/// This adapter sends email notifications through the configured email service.
pub struct EmailAdapter<E> {
    email_service: E,
    from_email: String,
    configuration_set: Option<String>,
}

impl<E> EmailAdapter<E> {
    /// Create a new email adapter that sends from `from_email`. With a `configuration_set`,
    /// every email is sent through that SES configuration set and tagged with its
    /// notification type, so its delivery events can be counted per type.
    pub fn new(email_service: E, from_email: String, configuration_set: Option<String>) -> Self {
        Self {
            email_service,
            from_email,
            configuration_set,
        }
    }
}

/// Routes an email's delivery events to a configuration set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryTracking<'a> {
    /// The SES configuration set that publishes the delivery events.
    pub configuration_set: &'a str,
    /// The notification type, as a valid SES tag value.
    pub notification_type: String,
}

/// One email, ready for the email service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutgoingEmail<'a> {
    /// The From header: Macro's address, with the sender's name when there is one.
    pub from: String,
    /// The recipient's address.
    pub to: &'a str,
    /// The address replies go to, when it is not the From address.
    pub reply_to: Option<&'a str>,
    /// The subject line.
    pub subject: &'a str,
    /// The HTML body.
    pub html_body: &'a str,
    /// The plain-text alternative to the HTML body.
    pub text_body: Option<&'a str>,
    /// Where delivery events go, when they are tracked.
    pub tracking: Option<DeliveryTracking<'a>>,
}

/// Trait for email service operations.
///
/// This allows the adapter to work with different email service implementations.
pub trait EmailServiceOps {
    /// Send an email.
    fn send_email(
        &self,
        email: &OutgoingEmail<'_>,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;
}

fn utf8_content(data: &str) -> Result<Content, Report> {
    Ok(Content::builder().data(data).charset("UTF-8").build()?)
}

impl EmailServiceOps for aws_sdk_sesv2::Client {
    async fn send_email(&self, email: &OutgoingEmail<'_>) -> Result<(), Report> {
        let dest = Destination::builder().to_addresses(email.to).build();

        let text = email.text_body.map(utf8_content).transpose()?;
        let body = Body::builder()
            .html(utf8_content(email.html_body)?)
            .set_text(text)
            .build();

        let msg = Message::builder()
            .subject(utf8_content(email.subject)?)
            .body(body)
            .build();

        let email_content = SesEmailContent::builder().simple(msg).build();

        let mut request = self
            .send_email()
            .from_email_address(&email.from)
            .destination(dest)
            .content(email_content)
            .set_reply_to_addresses(email.reply_to.map(|address| vec![address.to_owned()]));

        if let Some(tracking) = &email.tracking {
            let tag = MessageTag::builder()
                .name(NOTIFICATION_TYPE_TAG)
                .value(&tracking.notification_type)
                .build()?;
            request = request
                .configuration_set_name(tracking.configuration_set)
                .email_tags(tag);
        }

        request.send().await.map_err(|e| {
            rootcause::report!(
                "SES send failed: {}",
                aws_sdk_sns::error::DisplayErrorContext(&e)
            )
        })?;

        Ok(())
    }
}

/// Puts an untrusted sender name on one line without the characters a quoted display name
/// cannot carry, and caps it. Returns `None` when nothing printable is left.
fn sanitize_from_name(raw: &str) -> Option<String> {
    let unquoted: String = raw.chars().filter(|c| !matches!(c, '"' | '\\')).collect();
    let words: Vec<&str> = unquoted
        .split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|word| !word.is_empty())
        .collect();
    let capped: String = words.join(" ").chars().take(FROM_NAME_MAX_CHARS).collect();
    let name = capped.trim();
    (!name.is_empty()).then(|| name.to_owned())
}

/// Encodes `text` as RFC 2047 `Q` encoded words, which mail headers need for non-ASCII
/// display names. Each word stays within the length limit and never splits a character.
fn encoded_words(text: &str) -> String {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut utf8 = [0; 4];
    for c in text.chars() {
        let mut encoded = String::new();
        for byte in c.encode_utf8(&mut utf8).bytes() {
            match byte {
                b' ' => encoded.push('_'),
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'!' | b'*' | b'+' | b'-' | b'/' => {
                    encoded.push(char::from(byte))
                }
                _ => {
                    let _ = write!(encoded, "={byte:02X}");
                }
            }
        }
        if word.len() + encoded.len() > ENCODED_WORD_MAX_TEXT_LEN {
            words.push(std::mem::take(&mut word));
        }
        word.push_str(&encoded);
    }
    if !word.is_empty() {
        words.push(word);
    }

    words
        .iter()
        .map(|word| format!("=?UTF-8?Q?{word}?="))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The From header for `from_email`, naming the person Macro sends for when there is one.
fn from_header(from_email: &str, from_name: Option<&str>) -> String {
    let Some(name) = from_name.and_then(sanitize_from_name) else {
        return from_email.to_owned();
    };

    let display_name = format!("{name}{FROM_NAME_SUFFIX}");
    if display_name.is_ascii() {
        format!("\"{display_name}\" <{from_email}>")
    } else {
        format!("{} <{from_email}>", encoded_words(&display_name))
    }
}

/// The notification type as an SES tag value: ASCII letters, digits, `_`, and `-`.
fn tag_value(notification_type: &str) -> String {
    notification_type
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .take(TAG_VALUE_MAX_LEN)
        .collect()
}

impl<E: EmailServiceOps + Send + Sync + 'static> EmailSender for EmailAdapter<E> {
    async fn send_email(
        &self,
        recipient: MacroUserIdStr<'_>,
        notification_type: &str,
        content: &EmailContent,
    ) -> Result<(), Report> {
        let email_part = recipient.email_part();
        let email = OutgoingEmail {
            from: from_header(&self.from_email, content.from_name.as_deref()),
            to: email_part.email_str(),
            reply_to: content
                .reply_to
                .as_ref()
                .map(|address| address.0.email_str()),
            subject: &content.subject,
            html_body: &content.body,
            text_body: content.text.as_deref(),
            tracking: self
                .configuration_set
                .as_deref()
                .map(|configuration_set| DeliveryTracking {
                    configuration_set,
                    notification_type: tag_value(notification_type),
                }),
        };

        self.email_service.send_email(&email).await
    }
}

/// Signs the unsubscribe placeholders an email body carries before handing it to `inner`.
///
/// Producers render email bodies without the URL signing key, so a template marks its
/// unsubscribe link with [`notification::domain::models::signing::unsubscribe_placeholder`]. This
/// sender knows the recipient and holds the key.
pub struct SignedUnsubscribeLinks<S> {
    inner: S,
    notification_service_url: Url,
    signing_key: Hmac<Sha256>,
}

impl<S> SignedUnsubscribeLinks<S> {
    /// Wraps `inner`, signing links against the notification service's public URL.
    pub fn new(inner: S, notification_service_url: Url, signing_key: Hmac<Sha256>) -> Self {
        Self {
            inner,
            notification_service_url,
            signing_key,
        }
    }
}

impl<S: EmailSender> EmailSender for SignedUnsubscribeLinks<S> {
    async fn send_email(
        &self,
        recipient: MacroUserIdStr<'_>,
        notification_type: &str,
        content: &EmailContent,
    ) -> Result<(), Report> {
        let Some(body) = sign_unsubscribe_placeholders(
            &content.body,
            &self.notification_service_url,
            recipient.as_ref(),
            &self.signing_key,
        ) else {
            return self
                .inner
                .send_email(recipient, notification_type, content)
                .await;
        };
        let signed = EmailContent {
            body,
            ..content.clone()
        };
        self.inner
            .send_email(recipient, notification_type, &signed)
            .await
    }
}
