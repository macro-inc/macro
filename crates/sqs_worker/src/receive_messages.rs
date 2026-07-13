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
        .send()
        .await?;

    Ok(recv_output.messages.unwrap_or_default())
}
