//! Link-manager queue adapter that announces a dead Google grant.
//!
//! Backs [`CalendarReauthNotifier`] by enqueuing
//! [`LinkManagerMessage::NotifyReauthRequired`] onto the shared email
//! link-manager queue, whose email_service consumer owns the single
//! reconnect-your-inbox notification. Enqueued directly rather than through
//! `sqs_client`, whose `email` feature would pull `crates/email` back into
//! this service; the wire body is the shared `models_email` serde impl, so it
//! stays byte-compatible with the messages email_service enqueues.

use calendar_events::domain::ports::CalendarReauthNotifier;
use models_email::email::service::pubsub::LinkManagerMessage;
use rootcause::Report;
use uuid::Uuid;

/// [`CalendarReauthNotifier`] backed by the email link-manager SQS queue.
#[derive(Clone)]
pub struct LinkManagerReauthNotifier {
    client: aws_sdk_sqs::Client,
    queue_url: String,
}

impl LinkManagerReauthNotifier {
    /// Construct the notifier over an SQS client and the resolved queue URL.
    pub fn new(client: aws_sdk_sqs::Client, queue_url: impl Into<String>) -> Self {
        Self {
            client,
            queue_url: queue_url.into(),
        }
    }
}

impl CalendarReauthNotifier for LinkManagerReauthNotifier {
    #[tracing::instrument(skip(self))]
    async fn notify_reauth_required(&self, email_link_id: Uuid) -> Result<(), Report> {
        let body = encode_reauth_message(email_link_id).map_err(report)?;
        self.client
            .send_message()
            .queue_url(&self.queue_url)
            .message_body(body)
            .send()
            .await
            .map_err(report)?;
        Ok(())
    }
}

fn encode_reauth_message(email_link_id: Uuid) -> serde_json::Result<String> {
    serde_json::to_string(&LinkManagerMessage::NotifyReauthRequired {
        link_id: email_link_id,
    })
}

fn report(error: impl std::error::Error + Send + Sync + 'static) -> Report {
    rootcause::report!(error).into()
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn notify_reauth_required_wire_body_round_trips_as_link_manager_message() {
        let link_id = Uuid::now_v7();

        let body = encode_reauth_message(link_id).expect("message serializes");

        assert_eq!(
            body,
            format!(r#"{{"operation":"NotifyReauthRequired","link_id":"{link_id}"}}"#)
        );

        let decoded: LinkManagerMessage =
            serde_json::from_str(&body).expect("email_service deserializes the same bytes");
        assert!(matches!(
            decoded,
            LinkManagerMessage::NotifyReauthRequired { link_id: decoded_id } if decoded_id == link_id
        ));
    }
}
