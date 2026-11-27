use aws_sdk_sqs::types::MessageSystemAttributeName;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(test)]
mod test;

/// Receives messages from the queue.
#[tracing::instrument(skip(inner))]
pub async fn receive_messages(
    inner: &aws_sdk_sqs::Client,
    queue_url: &str,
    max_messages: i32,
    wait_time_seconds: i32,
) -> anyhow::Result<Vec<aws_sdk_sqs::types::Message>> {
    // TODO: ability to pass message attributes filter to receive messages
    let recv_output = inner
        .receive_message()
        .queue_url(queue_url)
        .wait_time_seconds(wait_time_seconds)
        .max_number_of_messages(max_messages)
        .set_message_attribute_names(Some(vec!["*".to_string()])) // Needed to get all the message
        // attributes
        .message_system_attribute_names(MessageSystemAttributeName::ApproximateReceiveCount)
        .message_system_attribute_names(MessageSystemAttributeName::SentTimestamp)
        .send()
        .await?;

    Ok(recv_output.messages.unwrap_or_default())
}

/// How many times SQS has delivered `message`, this delivery included.
pub fn receive_count(message: &aws_sdk_sqs::types::Message) -> Option<u32> {
    message
        .attributes()?
        .get(&MessageSystemAttributeName::ApproximateReceiveCount)?
        .parse()
        .ok()
}

/// How long `message` had been in its queue at `now`, counted from when SQS
/// accepted it (`SentTimestamp`), so earlier deliveries of it are included.
/// `None` without the attribute or when `now` reads earlier than it.
pub fn queue_wait(message: &aws_sdk_sqs::types::Message, now: SystemTime) -> Option<Duration> {
    let sent_ms: u64 = message
        .attributes()?
        .get(&MessageSystemAttributeName::SentTimestamp)?
        .parse()
        .ok()?;
    now.duration_since(UNIX_EPOCH + Duration::from_millis(sent_ms))
        .ok()
}
