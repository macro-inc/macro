//! The running sweep recovers parked projection work after a simulated
//! old-binary activation, which has no inline unpark call.

#![expect(
    clippy::disallowed_methods,
    reason = "test support: isolated scenario setup is not part of the production query cache"
)]

use email_e2e::{DEFAULT_TIMEOUT, Mail, Provider, Report, Stack, eventually};
use uuid::Uuid;

/// A legacy activation leaves a real ingested Message event parked. Only the
/// running sweep may recover it; reconnect and its inline unpark are not used.
/// When this fails, downstream consumers never hear of the recovered mail, or
/// receive it twice. The trigger and old-binary link flips exist only in this
/// scenario's database; PG unit tests cover page bounds and lock edge cases.
#[tokio::test(flavor = "multi_thread")]
async fn outlook_legacy_activation_recovers_a_parked_message_once() -> Result<(), Report> {
    let stack = Stack::start().await?;
    let user = stack.user("ada").await?;
    let inbox = user.link(Provider::Outlook, user.email()).await?;

    let mut sweep = stack.db().begin().await?;
    sqlx::query("SELECT id FROM email_projection_unpark_sweep WHERE id=true FOR UPDATE")
        .execute(&mut *sweep)
        .await?;
    sqlx::raw_sql(
        r#"
        CREATE FUNCTION test_park_message_projection() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.payload->>'kind' = 'message' THEN
                NEW.parked_at = now();
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER test_park_message_projection BEFORE INSERT
            ON email_projection_outbox FOR EACH ROW
            EXECUTE FUNCTION test_park_message_projection();
        "#,
    )
    .execute(stack.db())
    .await?;
    let delivered = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Parked projection recovery",
        "The sweep recovers this event.",
    ))?;
    let event: Uuid = eventually("the real Message event to be parked", DEFAULT_TIMEOUT, async || {
        Ok(sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM email_projection_outbox WHERE link_id=$1 AND payload->>'kind'='message' AND payload->>'provider_id'=$2 AND parked_at IS NOT NULL LIMIT 1"
        ).bind(inbox.link_id()).bind(delivered.id.as_str())
            .fetch_optional(stack.db()).await?)
    }).await?;
    assert!(
        !stack
            .email_events(inbox.link_id())
            .await?
            .iter()
            .any(|event| event["event_type"] == "email.message_received"
                && event["metadata"]["provider_message_id"] == delivered.id.as_str())
    );

    // Simulate an old binary reactivating the link without invoking recovery.
    sqlx::query("UPDATE email_links SET is_sync_active=false WHERE id=$1")
        .bind(inbox.link_id())
        .execute(stack.db())
        .await?;
    sqlx::query("UPDATE email_links SET is_sync_active=true WHERE id=$1")
        .bind(inbox.link_id())
        .execute(stack.db())
        .await?;
    sqlx::query(
        "UPDATE email_projection_unpark_sweep SET link_after=$1,available_at=now() WHERE id=true",
    )
    .bind(Uuid::nil())
    .execute(&mut *sweep)
    .await?;
    sweep.commit().await?;

    eventually(
        "the running sweep and projector to drain the parked event",
        DEFAULT_TIMEOUT,
        async || {
            let pending: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM email_projection_outbox WHERE id=$1)",
            )
            .bind(event)
            .fetch_one(stack.db())
            .await?;
            Ok((!pending).then_some(()))
        },
    )
    .await?;
    inbox
        .wait_for_preview("inbox", "Parked projection recovery")
        .await?;
    eventually(
        "the recovered MessageReceived publication",
        DEFAULT_TIMEOUT,
        async || {
            let events = stack.email_events(inbox.link_id()).await?;
            Ok(events
                .iter()
                .any(|event| {
                    event["event_type"] == "email.message_received"
                        && event["metadata"]["provider_message_id"] == delivered.id.as_str()
                })
                .then_some(()))
        },
    )
    .await?;

    sqlx::raw_sql("DROP TRIGGER test_park_message_projection ON email_projection_outbox; DROP FUNCTION test_park_message_projection()")
        .execute(stack.db()).await?;
    let later = inbox.deliver(&Mail::new(
        "Grace <grace@example.com>",
        "Recovery barrier",
        "A later event proves continued progress.",
    ))?;
    eventually(
        "a later MessageReceived publication",
        DEFAULT_TIMEOUT,
        async || {
            Ok(stack
                .email_events(inbox.link_id())
                .await?
                .iter()
                .any(|event| {
                    event["event_type"] == "email.message_received"
                        && event["metadata"]["provider_message_id"] == later.id.as_str()
                })
                .then_some(()))
        },
    )
    .await?;
    let events = stack.email_events(inbox.link_id()).await?;
    assert_eq!(
        events
            .iter()
            .filter(|event| event["event_type"] == "email.message_received"
                && event["metadata"]["provider_message_id"] == delivered.id.as_str())
            .count(),
        1
    );
    stack.finish().await
}
