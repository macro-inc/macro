//! Mail the provider returns because it could not be delivered.

use email_e2e::{Report, Stack, gmail_emulator};

/// A delivery failure as mail servers report it: the notice, the machine
/// readable status, and the original message wrapped whole.
fn bounce(to: &str) -> String {
    format!(
        "From: Mail Delivery Subsystem <mailer-daemon@example.net>\n\
         To: {to}\n\
         Subject: Delivery Status Notification (Failure)\n\
         Message-ID: <bounce-1@example.net>\n\
         Content-Type: multipart/report; report-type=delivery-status; boundary=\"report\"\n\
         \n\
         --report\n\
         Content-Type: text/plain; charset=utf-8\n\
         \n\
         Address not found: your message to gone@example.net was not delivered.\n\
         --report\n\
         Content-Type: message/delivery-status\n\
         \n\
         Reporting-MTA: dns; example.net\n\
         \n\
         Final-Recipient: rfc822; gone@example.net\n\
         Action: failed\n\
         Status: 5.1.1\n\
         \n\
         --report\n\
         Content-Type: message/rfc822\n\
         \n\
         From: {to}\n\
         To: gone@example.net\n\
         Subject: Our offer\n\
         Content-Type: multipart/alternative; boundary=\"original\"\n\
         \n\
         --original\n\
         Content-Type: text/plain; charset=utf-8\n\
         \n\
         The text of the returned offer.\n\
         --original\n\
         Content-Type: text/html; charset=utf-8\n\
         \n\
         <p>The markup of the returned offer.</p>\n\
         --original--\n\
         --report--\n"
    )
}

/// A bounce reads as the delivery failure, not as the message that
/// bounced.
///
/// When it fails: opening a bounce shows the user's own returned message,
/// so they cannot see that, or why, it was not delivered.
#[tokio::test(flavor = "multi_thread")]
async fn gmail_a_bounce_shows_the_failure_not_the_returned_message() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let ada = stack.user("ada").await?;
    let inbox = ada.link_gmail().await?;

    stack.gmail().deliver(
        inbox.email(),
        &gmail_emulator::NewMessage {
            raw: Some(bounce(inbox.email())),
            ..Default::default()
        },
    )?;
    let preview = inbox
        .wait_for_preview("inbox", "Delivery Status Notification (Failure)")
        .await?;
    let thread = inbox
        .thread(preview["id"].as_str().unwrap_or_default())
        .await?;
    let message = &thread["messages"][0];

    let text = message["body_text"].as_str().unwrap_or_default();
    assert!(text.contains("was not delivered"), "{message}");
    assert!(!message.to_string().contains("returned offer"), "{message}");

    stack.finish().await
}
