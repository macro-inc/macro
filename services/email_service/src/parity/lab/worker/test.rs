use super::*;

#[test]
fn outcomes_keep_acknowledgements_delays_and_result_independent() {
    let delivery = Delivery::new("body");
    let sent = Sent {
        queue_url: "retry".into(),
        body: "same body".into(),
        delay_seconds: 60,
        message_id: "sent".into(),
    };
    let (value, deleted) = outcome(
        &delivery,
        &[sent],
        &[Ack::Visibility {
            receipt: "delivery-receipt-1".into(),
            seconds: 17,
        }],
        &Ok(()),
    );
    assert!(!deleted);
    assert_eq!(
        value,
        json!({
            "result":{"Ok":null}, "deleted":false, "left_for_redelivery":true,
            "visibility_seconds":[17], "sent":[{"queue":"retry","body":"same body","delay_seconds":60}],
        })
    );
    let (value, deleted) = outcome(
        &delivery,
        &[],
        &[Ack::Deleted {
            receipt: "delivery-receipt-1".into(),
        }],
        &Err(anyhow::anyhow!("failure")),
    );
    assert!(deleted);
    assert_eq!(value["result"], json!({"Err":"failure"}));
    assert_eq!(value["left_for_redelivery"], false);
}

#[test]
fn redelivery_keeps_identity_body_and_attributes() {
    let mut delivery = Delivery::new("opaque body");
    delivery
        .attributes
        .insert("SentTimestamp".into(), "123".into());
    delivery.message_attributes =
        json!({"traceparent":{"DataType":"String","StringValue":"trace"}});
    let again = delivery.redelivered();
    assert_eq!(again.body, delivery.body);
    assert_eq!(again.message_id, delivery.message_id);
    assert_eq!(again.attributes, delivery.attributes);
    assert_eq!(again.message_attributes, delivery.message_attributes);
    assert_eq!(again.receive_count, 2);
    assert_ne!(again.receipt_handle, delivery.receipt_handle);
    assert_eq!(again.wire()["Attributes"]["ApproximateReceiveCount"], "2");
}

#[tokio::test]
async fn real_receive_consumes_only_the_selected_delivery() {
    let sqs = crate::pubsub::label_write_sim::fake_sqs::FakeSqs::start().await;
    let first_queue = sqs.queue_url("first");
    let second_queue = sqs.queue_url("second");
    sqs.deliver(&first_queue, Delivery::new("first").wire());
    sqs.deliver(&second_queue, Delivery::new("second").wire());
    let worker = sqs_worker::SQSWorker::new(
        crate::pubsub::label_write_sim::fake_sqs::client(&sqs.url, false),
        first_queue,
        1,
        0,
    );
    let messages = worker.receive_messages().await.expect("receive");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].body(), Some("first"));
    assert_eq!(
        messages[0]
            .attributes()
            .expect("attributes")
            .get(&aws_sdk_sqs::types::MessageSystemAttributeName::ApproximateReceiveCount)
            .map(String::as_str),
        Some("1")
    );
    assert!(
        worker
            .receive_messages()
            .await
            .expect("empty receive")
            .is_empty()
    );
    assert_eq!(sqs.lock().deliveries[&second_queue].len(), 1);
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn changed_body_changes_only_delivery_and_sqs(pool: sqlx::PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = Lab::start_worker_lab(
        pool,
        crate::parity::lab::LabOptions {
            suite: "self_tests",
            name: "worker_sensitivity",
            shard: 59000,
            gmail_label_write_batches: true,
        },
    )
    .await;
    lab.start_workers().await;
    for body in ["x", "y"] {
        let result = lab
            .worker_step("malformed", Queue::GmailOps, &Delivery::new(body))
            .await;
        assert!(result.deleted);
        assert!(result.result.is_err());
    }
    let text = lab.transcript.take();
    let steps: Vec<_> = text.split("step: malformed\n").skip(1).collect();
    assert_eq!(steps.len(), 2);
    let sections = |step: &str| -> std::collections::BTreeMap<String, String> {
        let mut result = std::collections::BTreeMap::new();
        let mut name = String::new();
        for line in step.lines() {
            if !line.starts_with(' ') && line.ends_with(':') {
                name = line.to_owned();
                result.insert(name.clone(), String::new());
            } else if let Some(section) = result.get_mut(&name) {
                section.push_str(line);
                section.push('\n');
            }
        }
        result
    };
    let first = sections(steps[0]);
    let second = sections(steps[1]);
    let changed: Vec<_> = first
        .keys()
        .filter(|key| first[*key] != second[*key])
        .map(String::as_str)
        .collect();
    assert_eq!(changed, ["delivery:", "sqs:"]);
}
