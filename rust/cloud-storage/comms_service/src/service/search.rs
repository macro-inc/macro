#[tracing::instrument(skip(sqs_client))]
pub fn send_channel_message_to_search_extractor_queue(
    sqs_client: &sqs_client::SQS,
    channel_id: impl ToString + std::fmt::Debug,
    message_id: impl ToString + std::fmt::Debug,
) {
    #[cfg(feature = "channel_search")]
    {
        use tracing::Instrument;

        tracing::trace!("enqueueing message to search");

        let channel_id = channel_id.to_string();
        let message_id = message_id.to_string();

        // TODO: may need to handle retries as we could hit SQS fifo limits here
        tokio::spawn({
            let sqs_client = sqs_client.clone();
            async move {
                let _ = sqs_client
                    .send_message_to_search_event_queue(
                        sqs_client::search::SearchQueueMessage::ChannelMessageUpdate(
                            sqs_client::search::channel::ChannelMessageUpdate {
                                channel_id,
                                message_id,
                            },
                        ),
                    )
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue message");
                    });
            }
            .in_current_span()
        });
    }
}

#[tracing::instrument(skip(sqs_client))]
pub fn send_remove_channel_message_to_search_extractor_queue(
    sqs_client: &sqs_client::SQS,
    channel_id: impl ToString + std::fmt::Debug,
    message_id: Option<impl ToString + std::fmt::Debug>,
) {
    #[cfg(feature = "channel_search")]
    {
        use tracing::Instrument;

        tracing::trace!("enqueueing message to search");

        let channel_id = channel_id.to_string();
        let message_id = message_id.map(|s| s.to_string());

        // TODO: may need to handle retries as we could hit SQS fifo limits here
        tokio::spawn({
            let sqs_client = sqs_client.clone();
            async move {
                let _ = sqs_client
                    .send_message_to_search_event_queue(
                        sqs_client::search::SearchQueueMessage::RemoveChannelMessage(
                            sqs_client::search::channel::RemoveChannelMessage {
                                channel_id,
                                message_id,
                            },
                        ),
                    )
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "SEARCH_QUEUE unable to enqueue message");
                    });
            }
            .in_current_span()
        });
    }
}
