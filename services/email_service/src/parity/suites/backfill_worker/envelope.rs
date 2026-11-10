use super::*;

#[derive(Clone, Copy)]
enum Case {
    Decode,
    Status,
    Link,
    JobFault,
    LinkFault,
    DeleteFailure,
    NoReceipt,
    Outlook,
    Inactive,
    CrossLink,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Envelope and eligibility fixture SQL"
)]
async fn envelope(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Case) {
    let mut lab = start(pool, name, shard).await;
    match case {
        Case::Decode => {
            for body in [
                None,
                Some(""),
                Some("{"),
                Some("null"),
                Some("{}"),
                Some(r#"{"backfillOperation":{"unknown":{}}}"#),
                Some(r#"{"backfillOperation":{"init":{"link_id":"bad","job_id":"bad"}}}"#),
                Some(r#"{"backfillOperation":{"init":{}}}"#),
            ] {
                let mut message = Delivery::new(body.unwrap_or_default());
                message.body = body.map(str::to_owned);
                message.receive_count = count;
                let result = step(&mut lab, &format!("decode {body:?}"), &message).await;
                assert!(result.deleted);
                assert!(result.result.is_err());
            }
        }
        Case::Status => {
            for status in ["Init", "InProgress", "Complete", "Failed", "Cancelled"] {
                seed_job(&lab, status, 100).await;
                for op in [
                    "init",
                    "list_threads",
                    "backfill_thread",
                    "backfill_message",
                    "update_thread_metadata",
                    "seed_sent_contact",
                ] {
                    let p = match op {
                        "list_threads" => list_payload(false),
                        "backfill_thread" => thread_payload("t1", false),
                        "backfill_message" => message_payload(&lab, "m1a").await,
                        "update_thread_metadata" => {
                            let mut p = message_payload(&lab, "m1a").await;
                            p.as_object_mut().unwrap().remove("message_provider_id");
                            p
                        }
                        "seed_sent_contact" => json!({"message_provider_id":"gone"}),
                        _ => json!({}),
                    };
                    // Active operations are characterized in their operation files.
                    if matches!(status, "Init" | "InProgress") {
                        continue;
                    }
                    let message = delivery(&lab, op, p, count);
                    let result = step(&mut lab, &format!("{status} {op}"), &message).await;
                    assert!(result.deleted);
                    result.result.expect("terminal job no-op");
                }
            }
        }
        Case::Link => {
            let message = delivery(&lab, "backfill_thread", thread_payload("t1", false), count);
            sqlx::query("UPDATE email_backfill_jobs SET link_id=NULL WHERE id=$1")
                .bind(JOB)
                .execute(&lab.db)
                .await
                .unwrap();
            sqlx::query("DELETE FROM email_links WHERE id=$1")
                .bind(lab.fixture.links[0])
                .execute(&lab.db)
                .await
                .unwrap();
            step(&mut lab, "missing link terminal", &message)
                .await
                .result
                .expect("terminal policy");
        }
        Case::JobFault | Case::LinkFault => {
            let message = delivery(&lab, "backfill_thread", thread_payload("t1", false), count);
            lab.sql_fault
                .fail_acquisition(if matches!(case, Case::JobFault) { 1 } else { 2 });
            let result = step(&mut lab, "lookup fault", &message).await;
            assert!(!result.deleted);
            result.result.expect("retry policy");
        }
        Case::DeleteFailure => {
            lab.sqs.lock().fail_delete = true;
            let mut bad = Delivery::new("{");
            bad.receive_count = count;
            assert!(
                step(&mut lab, "bad payload and failed delete", &bad)
                    .await
                    .result
                    .is_err()
            );
            let message = delivery(
                &lab,
                "seed_sent_contact",
                json!({"message_provider_id":"gone"}),
                count,
            );
            persistent(&lab, "messages/gone", 404, rejection(404));
            assert!(
                step(&mut lab, "success and failed delete", &message)
                    .await
                    .result
                    .is_err()
            );
        }
        Case::Outlook | Case::Inactive | Case::CrossLink => {
            let mut message = delivery(
                &lab,
                "backfill_thread",
                thread_payload("boundary-thread", false),
                count,
            );
            if matches!(case, Case::Outlook) {
                sqlx::query("UPDATE email_links SET provider='OUTLOOK' WHERE id=$1")
                    .bind(lab.fixture.links[0])
                    .execute(&lab.db)
                    .await
                    .unwrap();
            } else if matches!(case, Case::Inactive) {
                sqlx::query(
                    "UPDATE email_links SET is_sync_active=false,needs_reauth=true WHERE id=$1",
                )
                .bind(lab.fixture.links[0])
                .execute(&lab.db)
                .await
                .unwrap();
            } else {
                let mut body: Value = serde_json::from_str(message.body.as_ref().unwrap()).unwrap();
                body["backfillOperation"]["backfill_thread"]["link_id"] =
                    json!(lab.fixture.links[1]);
                body["backfillOperation"]["backfill_thread"]["thread_provider_id"] = json!("b1");
                message.body = Some(body.to_string());
            }
            persistent(
                &lab,
                "threads/boundary-thread",
                200,
                json!({"id":"boundary-thread","messages":[]}),
            );
            step(&mut lab, "link boundary", &message)
                .await
                .result
                .expect("policy");
        }
        Case::NoReceipt => {
            let mut message = delivery(
                &lab,
                "seed_sent_contact",
                json!({"message_provider_id":"gone"}),
                count,
            );
            persistent(&lab, "messages/gone", 404, rejection(404));
            message.receipt_handle = None;
            step(&mut lab, "missing receipt", &message).await;
        }
    }
    lab.transcript.finish();
}

cases! {envelope;
    outlook_link,72703,1,Case::Outlook; outlook_link_redelivery,75703,20,Case::Outlook;
    inactive_reauth_link,72706,1,Case::Inactive; inactive_reauth_link_redelivery,75706,20,Case::Inactive;
    cross_link_job_scope,72709,1,Case::CrossLink; cross_link_job_scope_redelivery,75709,20,Case::CrossLink;
    invalid_envelopes, 71000, 1, Case::Decode;
    invalid_envelopes_redelivery, 71003, 20, Case::Decode;
    terminal_job_operations, 71006, 1, Case::Status;
    terminal_job_operations_redelivery, 71009, 20, Case::Status;
    missing_link, 71012, 1, Case::Link;
    missing_link_redelivery, 71015, 2, Case::Link;
    job_query_failure, 71018, 1, Case::JobFault;
    job_query_failure_redelivery, 71021, 2, Case::JobFault;
    link_query_failure, 71024, 1, Case::LinkFault;
    link_query_failure_redelivery, 71027, 2, Case::LinkFault;
    deletion_failure, 71030, 1, Case::DeleteFailure;
    deletion_failure_redelivery, 71033, 2, Case::DeleteFailure;
    missing_receipt, 71036, 1, Case::NoReceipt;
    missing_receipt_redelivery,74036,20,Case::NoReceipt;
}
