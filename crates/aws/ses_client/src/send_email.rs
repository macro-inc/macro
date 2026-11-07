use anyhow::Context;
use aws_sdk_sesv2::{
    self as ses,
    types::{Body, Content, Destination, EmailContent, Message},
};

/// Sends an email to the user
#[tracing::instrument(skip(client, content))]
pub async fn send_email(
    client: &ses::Client,
    from_email: &str,
    to_email: &str,
    subject: &str,
    content: &str,
) -> anyhow::Result<()> {
    let mut dest: Destination = Destination::builder().build();
    dest.to_addresses = Some(vec![to_email.to_string()]);

    let subject_content = Content::builder()
        .data(subject)
        .charset("UTF-8")
        .build()
        .context("building subject Content")?;

    let body_content = Content::builder()
        .data(content)
        .charset("UTF-8")
        .build()
        .context("building body Content")?;

    let body = Body::builder().html(body_content).build();

    let msg = Message::builder()
        .subject(subject_content)
        .body(body)
        .build();

    let email_content = EmailContent::builder().simple(msg).build();

    client
        .send_email()
        .from_email_address(from_email)
        .destination(dest)
        .content(email_content)
        .send()
        .await?;

    Ok(())
}
