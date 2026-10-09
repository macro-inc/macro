use std::time::Duration;

#[cfg(test)]
mod test;

const RECEIVE_ERROR_DELAY: Duration = Duration::from_secs(5);

/// Receives messages from the queue, delaying failures to prevent busy retry loops.
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
        .send()
        .await;

    let recv_output = match recv_output {
        Ok(output) => output,
        Err(error) => {
            // DNS and connection failures can return immediately. Callers poll
            // continuously, so impose a floor even after SDK retries are exhausted.
            tokio::time::sleep(RECEIVE_ERROR_DELAY).await;
            return Err(error.into());
        }
    };

    Ok(recv_output.messages.unwrap_or_default())
}
