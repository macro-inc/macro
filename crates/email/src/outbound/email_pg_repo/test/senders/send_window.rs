use super::*;

struct CheckpointProvider(Arc<std::sync::Mutex<Option<chrono::DateTime<Utc>>>>);

impl EmailSenderProvider for CheckpointProvider {
    fn send_as<'a>(&'a self, link: &'a Link, refresh: bool) -> SendAsFuture<'a> {
        Box::pin(async move {
            let senders = Provider.send_as(link, refresh).await?;
            *self.0.lock().unwrap() = Some(Utc::now());
            Ok(senders)
        })
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn alias_validation_does_not_consume_the_undo_window(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let validated_at = Arc::new(std::sync::Mutex::new(None));
    let mut service = super::super::thread_unread::service(pool)
        .with_sender_provider(CheckpointProvider(validated_at.clone()));
    service.sent_undo_delay_secs = 10;
    let sent = service
        .send_message_for_user_impl(actor(), Some(inbox_id()), draft())
        .await?;
    let earliest = validated_at.lock().unwrap().unwrap() + chrono::Duration::seconds(10);
    assert!(sent.send_time.unwrap() >= earliest);
    Ok(())
}
