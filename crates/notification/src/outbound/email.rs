//! Email notification adapter.

use aws_sdk_sesv2::types::{Body, Content, Destination, EmailContent as SesEmailContent, Message};
use hmac::Hmac;
use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sha2::Sha256;
use url::Url;

use crate::domain::models::queue_message::EmailContent;
use crate::domain::models::signing::sign_unsubscribe_placeholders;
use crate::domain::ports::EmailSender;

/// Email notification adapter.
///
/// This adapter sends email notifications through the configured email service.
pub struct EmailAdapter<E> {
    email_service: E,
    from_email: String,
}

impl<E> EmailAdapter<E> {
    /// Create a new email adapter.
    pub fn new(email_service: E, from_email: String) -> Self {
        Self {
            email_service,
            from_email,
        }
    }
}

/// Trait for email service operations.
///
/// This allows the adapter to work with different email service implementations.
pub trait EmailServiceOps {
    /// Send an email to the given address.
    fn send_email(
        &self,
        from_email: &str,
        to_email: &str,
        subject: &str,
        html_body: &str,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;
}

impl EmailServiceOps for aws_sdk_sesv2::Client {
    async fn send_email(
        &self,
        from_email: &str,
        to_email: &str,
        subject: &str,
        html_body: &str,
    ) -> Result<(), Report> {
        let dest = Destination::builder().to_addresses(to_email).build();

        let subject_content = Content::builder().data(subject).charset("UTF-8").build()?;

        let body_content = Content::builder()
            .data(html_body)
            .charset("UTF-8")
            .build()?;

        let body = Body::builder().html(body_content).build();

        let msg = Message::builder()
            .subject(subject_content)
            .body(body)
            .build();

        let email_content = SesEmailContent::builder().simple(msg).build();

        self.send_email()
            .from_email_address(from_email)
            .destination(dest)
            .content(email_content)
            .send()
            .await
            .map_err(|e| {
                rootcause::report!(
                    "SES send failed: {}",
                    aws_sdk_sns::error::DisplayErrorContext(&e)
                )
            })?;

        Ok(())
    }
}

impl<E: EmailServiceOps + Send + Sync + 'static> EmailSender for EmailAdapter<E> {
    async fn send_email(
        &self,
        recipient: MacroUserIdStr<'_>,
        content: &EmailContent,
    ) -> Result<(), Report> {
        let email_part = recipient.email_part();
        let to_email = email_part.email_str();

        self.email_service
            .send_email(&self.from_email, to_email, &content.subject, &content.body)
            .await
    }
}

/// Signs the unsubscribe placeholders an email body carries before handing it to `inner`.
///
/// Producers render email bodies without the URL signing key, so a template marks its
/// unsubscribe link with [`crate::domain::models::signing::unsubscribe_placeholder`]. This
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
        content: &EmailContent,
    ) -> Result<(), Report> {
        let Some(body) = sign_unsubscribe_placeholders(
            &content.body,
            &self.notification_service_url,
            recipient.as_ref(),
            &self.signing_key,
        ) else {
            return self.inner.send_email(recipient, content).await;
        };
        let signed = EmailContent {
            subject: content.subject.clone(),
            body,
        };
        self.inner.send_email(recipient, &signed).await
    }
}
