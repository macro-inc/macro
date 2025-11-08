use model_notifications::NotificationWithRecipient;

pub fn get_metadata_value<T: serde::de::DeserializeOwned>(
    notification: &NotificationWithRecipient,
    key: &str,
) -> anyhow::Result<T> {
    if let Some(metadata) = &notification.inner.notification_event.metadata_json() {
        let value = metadata
            .get(key)
            .ok_or_else(|| anyhow::anyhow!("metadata key not found"))?;

        return serde_json::from_value(value.clone())
            .map_err(|e| anyhow::anyhow!("unable to deserialize metadata value: {e}"));
    }

    Err(anyhow::anyhow!("notification does not have metadata"))
}
