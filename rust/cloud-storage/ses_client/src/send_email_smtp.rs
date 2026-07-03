//! SMTP delivery for local mode. Sends to a plaintext SMTP sink (Mailpit) so
//! local email flows are inspectable without SES or real credentials.

use anyhow::{Context, Result};
use lettre::message::Mailbox;
use lettre::message::header::ContentType;
use lettre::{Address, AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

/// Send an HTML email over plaintext SMTP (no TLS/auth — Mailpit accepts any).
pub async fn send_email_smtp(
    host: &str,
    port: u16,
    from_email: &str,
    to_email: &str,
    subject: &str,
    content: &str,
) -> Result<()> {
    let from = mailbox(from_email).context("parsing from address")?;
    let to = mailbox(to_email).context("parsing to address")?;

    let email = Message::builder()
        .from(from)
        .to(to)
        .subject(subject)
        .header(ContentType::TEXT_HTML)
        .body(content.to_string())
        .context("building SMTP message")?;

    let mailer: AsyncSmtpTransport<Tokio1Executor> =
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
            .port(port)
            .build();

    mailer.send(email).await.context("sending via SMTP")?;
    Ok(())
}

fn mailbox(email: &str) -> Result<Mailbox> {
    let address: Address = email
        .parse()
        .with_context(|| format!("invalid email '{email}'"))?;
    Ok(Mailbox::new(None, address))
}
