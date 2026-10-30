pub async fn change_message_visibility(
    inner: &aws_sdk_sqs::Client,
    queue_url: &str,
    receipt_handle: &str,
    visibility_timeout_seconds: i32,
) -> anyhow::Result<()> {
    inner
        .change_message_visibility()
        .queue_url(queue_url)
        .receipt_handle(receipt_handle)
        .visibility_timeout(visibility_timeout_seconds)
        .send()
        .await?;

    Ok(())
}
