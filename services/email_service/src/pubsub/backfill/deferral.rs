use sqs_client::email::BACKFILL_DEFERRALS_ATTRIBUTE;

/// How often the received operation has already been deferred.
pub(crate) fn deferrals(message: &aws_sdk_sqs::types::Message) -> u32 {
    message
        .message_attributes()
        .and_then(|attributes| attributes.get(BACKFILL_DEFERRALS_ATTRIBUTE))
        .and_then(|value| value.string_value())
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod test;
