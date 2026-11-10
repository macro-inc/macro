//! Opt-in response paths whose database queries do not define an array order.

use serde_json::Value;

mod test;

#[derive(Clone, Copy)]
pub(in crate::parity) enum ResponseArrayRule {
    /// $.body.labels and $.body[*].labels: ORDER BY message_id only.
    MessageLabelsByProviderId,
    /// $.body.messages[*] on scheduled drafts: bulk lookups do not order labels or recipients.
    ScheduledMessageFields,
    /// $.body.{to,cc,bcc} and $.body[*].{to,cc,bcc}: no order within a role.
    MessageRecipientsByAddress,
    /// $.body on POST message batch routes: no ORDER BY.
    BatchMessagesById,
    /// $.body on GET thread message routes: ties in internal_date_ts only.
    ThreadTimestampTiesById,
}

impl ResponseArrayRule {
    pub fn apply(self, request: &Value, response: &mut Value) {
        let Some(body) = response.get_mut("body") else {
            return;
        };
        match self {
            Self::ScheduledMessageFields => {
                if request["method"] == "GET"
                    && request["path"].as_str().is_some_and(|path| {
                        path.split('?').next() == Some("/email/drafts/scheduled")
                    })
                    && let Some(messages) = body.get_mut("messages").and_then(Value::as_array_mut)
                {
                    for message in messages {
                        Self::MessageLabelsByProviderId.sort_message_fields(message);
                        Self::MessageRecipientsByAddress.sort_message_fields(message);
                    }
                }
            }
            Self::MessageLabelsByProviderId | Self::MessageRecipientsByAddress => {
                if let Some(messages) = body.as_array_mut() {
                    for message in messages {
                        self.sort_message_fields(message);
                    }
                } else {
                    self.sort_message_fields(body);
                }
            }
            Self::BatchMessagesById => {
                let path = request["path"].as_str().unwrap_or("").split('?').next();
                if request["method"] == "POST"
                    && matches!(
                        path,
                        Some("/email/messages/batch" | "/internal/messages/batch")
                    )
                    && let Some(messages) = body.as_array_mut()
                {
                    sort_by_fields(messages, &["db_id"]);
                }
            }
            Self::ThreadTimestampTiesById => {
                let path = request["path"].as_str().unwrap_or("").split('?').next();
                if request["method"] == "GET"
                    && path.is_some_and(|path| {
                        (path.starts_with("/email/threads/")
                            || path.starts_with("/internal/threads/"))
                            && path.ends_with("/messages")
                    })
                    && let Some(messages) = body.as_array_mut()
                {
                    // Keep the SQL's primary ordering visible. Only adjacent
                    // equal timestamps (including null) have unspecified order.
                    for ties in
                        messages.chunk_by_mut(|a, b| a["internal_date_ts"] == b["internal_date_ts"])
                    {
                        sort_by_fields(ties, &["db_id"]);
                    }
                }
            }
        }
    }

    fn sort_message_fields(self, message: &mut Value) {
        match self {
            Self::MessageLabelsByProviderId => {
                if let Some(labels) = message.get_mut("labels").and_then(Value::as_array_mut) {
                    sort_by_fields(labels, &["provider_id", "name"]);
                }
            }
            Self::MessageRecipientsByAddress => {
                for role in ["to", "cc", "bcc"] {
                    if let Some(recipients) = message.get_mut(role).and_then(Value::as_array_mut) {
                        sort_by_fields(recipients, &["email", "name", "photo_url"]);
                    }
                }
            }
            Self::BatchMessagesById
            | Self::ThreadTimestampTiesById
            | Self::ScheduledMessageFields => unreachable!(),
        }
    }
}

fn sort_by_fields(values: &mut [Value], fields: &[&str]) {
    values.sort_by(|a, b| {
        fields
            .iter()
            .map(|field| a[*field].as_str().cmp(&b[*field].as_str()))
            .find(|order| !order.is_eq())
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}
