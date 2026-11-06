pub async fn delete_message(
    inner: &aws_sdk_sqs::Client,
    queue_url: &str,
    receipt_handle: &str,
) -> anyhow::Result<()> {
    inner
        .delete_message()
        .queue_url(queue_url)
        .receipt_handle(receipt_handle)
        .send()
        .await?;

    Ok(())
}
