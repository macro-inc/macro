use super::signing::Key;
use super::*;

#[derive(Clone, Copy)]
enum Scenario {
    Known,
    Inactive,
    WrongProvider,
    Unknown,
    Envelope,
    Payload,
    Extractor,
    QueueFailure,
    DatabaseFailure,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Suite-local fault and inbox fixtures"
)]
async fn run(pool: PgPool, name: &'static str, shard: u32, scenario: Scenario) {
    let (mut lab, _redis) = start(pool, name, shard).await;
    let key = Key::new(&mut lab, "current");
    key.serve(&lab);
    let token = key.valid(&mut lab);
    let email: String =
        sqlx::query_scalar("SELECT email_address::text FROM email_links WHERE id=$1")
            .bind(lab.fixture.links[0])
            .fetch_one(&lab.db)
            .await
            .expect("inbox address");
    match scenario {
        Scenario::Known => {
            for (step, history) in [
                ("known inbox", 101),
                ("redelivery", 101),
                ("older history", 99),
                ("zero history", 0),
                ("maximum history", u64::MAX),
            ] {
                push(
                    &mut lab,
                    step,
                    &token,
                    notification(&email, json!(history)),
                    202,
                )
                .await;
            }
        }
        Scenario::Inactive => {
            sqlx::query(
                "UPDATE email_links SET is_sync_active=false,needs_reauth=true WHERE id=$1",
            )
            .bind(lab.fixture.links[0])
            .execute(&lab.db)
            .await
            .expect("inactive inbox");
            push(
                &mut lab,
                "inactive inbox still queues",
                &token,
                notification(&email, json!(102)),
                202,
            )
            .await;
        }
        Scenario::WrongProvider => {
            sqlx::query("UPDATE email_links SET provider='OUTLOOK' WHERE id=$1")
                .bind(lab.fixture.links[0])
                .execute(&lab.db)
                .await
                .expect("different provider");
            push(
                &mut lab,
                "Outlook address does not match",
                &token,
                notification(&email, json!(103)),
                202,
            )
            .await;
        }
        Scenario::Unknown => {
            for address in [
                "missing@example.com",
                "",
                "not an address",
                &email.to_uppercase(),
            ] {
                let status = if address.is_empty() { 500 } else { 202 };
                push(
                    &mut lab,
                    "unknown or differently cased address",
                    &token,
                    notification(address, json!(104)),
                    status,
                )
                .await;
            }
        }
        Scenario::Envelope => {
            let valid = notification(&email, json!(100));
            for (field, value) in [("messageId", json!(1)), ("publishTime", json!(null))] {
                let mut body = valid.clone();
                body["message"][field] = value;
                push(&mut lab, "invalid message field type", &token, body, 422).await;
            }
            let mut body = valid.clone();
            body["subscription"] = json!(1);
            push(&mut lab, "invalid subscription type", &token, body, 422).await;
            let mut body = notification("missing@example.com", json!(1));
            body["message"]["messageId"] = json!("");
            body["message"]["publishTime"] = json!("not a timestamp");
            body["subscription"] = json!("");
            push(
                &mut lab,
                "empty envelope metadata is accepted",
                &token,
                body,
                202,
            )
            .await;
            for field in ["data", "messageId", "publishTime"] {
                let mut body = valid.clone();
                body["message"]
                    .as_object_mut()
                    .expect("message object")
                    .remove(field);
                push(&mut lab, "missing message field", &token, body, 422).await;
            }
            let mut body = valid.clone();
            body.as_object_mut()
                .expect("envelope object")
                .remove("subscription");
            push(&mut lab, "missing subscription", &token, body, 422).await;
            for body in [
                json!({}),
                json!({"message":{}}),
                json!({"message":null,"subscription":"s"}),
                json!({"message":{"data":"e30=","messageId":"m","publishTime":"t"}}),
                json!({"message":{"data":{},"messageId":"m","publishTime":"t"},"subscription":"s"}),
                json!({"message":{"data":"e30=","publishTime":"t"},"subscription":"s"}),
                json!({"message":{"data":"e30=","messageId":"m"},"subscription":"s"}),
            ] {
                push(&mut lab, "malformed envelope", &token, body, 422).await;
            }
        }
        Scenario::Payload => {
            for data in [
                "%%%".to_owned(),
                URL_SAFE.encode("not JSON"),
                URL_SAFE.encode([0xff]),
                URL_SAFE.encode("{}"),
                URL_SAFE.encode(r#"{"emailAddress":"x"}"#),
                URL_SAFE.encode(r#"{"historyId":1}"#),
                URL_SAFE.encode(r#"{"emailAddress":null,"historyId":1}"#),
                URL_SAFE.encode(r#"{"emailAddress":"x","historyId":"1"}"#),
                URL_SAFE.encode(r#"{"emailAddress":"x","historyId":-1}"#),
                URL_SAFE.encode(r#"{"emailAddress":"x","historyId":18446744073709551616}"#),
            ] {
                push(
                    &mut lab,
                    "malformed encoded payload",
                    &token,
                    envelope(data),
                    422,
                )
                .await;
            }
        }
        Scenario::Extractor => {
            for (step, bytes, content_type, status) in [
                ("invalid JSON", b"{".as_slice(), "application/json", 400),
                ("non-JSON content type", b"{}".as_slice(), "text/plain", 415),
                ("empty JSON", b"".as_slice(), "application/json", 400),
            ] {
                assert_eq!(
                    lab.request(
                        step,
                        "POST",
                        "/gmail/webhook",
                        Auth::MissingCredentials,
                        RequestBody::Raw {
                            bytes: bytes.to_vec(),
                            content_type
                        }
                    )
                    .await,
                    status
                );
            }
            assert_eq!(
                lab.request(
                    "body exceeds the default limit",
                    "POST",
                    "/gmail/webhook",
                    Auth::MissingCredentials,
                    RequestBody::Raw {
                        bytes: vec![0xff; 2 * 1024 * 1024 + 1],
                        content_type: "application/json"
                    }
                )
                .await,
                413
            );
        }
        Scenario::QueueFailure => {
            lab.sqs.set_outage(true);
            push(
                &mut lab,
                "SQS unavailable",
                &token,
                notification(&email, json!(105)),
                500,
            )
            .await;
        }
        Scenario::DatabaseFailure => {
            sqlx::query("ALTER TABLE email_links RENAME TO parity_hidden_links")
                .execute(&lab.db)
                .await
                .expect("database fault");
            push(
                &mut lab,
                "inbox lookup fails",
                &token,
                notification(&email, json!(106)),
                500,
            )
            .await;
        }
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn webhook_known(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "webhook_known", 51000, Scenario::Known).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn webhook_inactive(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "webhook_inactive", 51003, Scenario::Inactive).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn webhook_wrong_provider(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "webhook_wrong_provider",
        51006,
        Scenario::WrongProvider,
    )
    .await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn webhook_unknown(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "webhook_unknown", 51009, Scenario::Unknown).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn webhook_envelope(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "webhook_envelope", 51012, Scenario::Envelope).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn webhook_payload(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "webhook_payload", 51015, Scenario::Payload).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn webhook_extractor(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "webhook_extractor", 51018, Scenario::Extractor).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn webhook_queue_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(pool, "webhook_queue_failure", 51021, Scenario::QueueFailure).await;
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn webhook_database_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    run(
        pool,
        "webhook_database_failure",
        51024,
        Scenario::DatabaseFailure,
    )
    .await;
}
