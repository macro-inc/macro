//! Queue-level characterization of the unchanged Gmail operations worker.

use crate::parity::lab::worker::{Delivery, Queue};
use crate::parity::lab::{Lab, LabOptions};
use crate::pubsub::label_write_sim::{
    fake_gmail::{GmailMessage, HttpReply},
    world,
};
use models_email::gmail::gmail_ops::{
    BlockSenderPayload, DeleteLabelPayload, GmailMessageRef, GmailOpsOperation,
    GmailOpsPubsubMessage, ModifyMessageLabelsBatchPayload, ModifyMessageLabelsPayload,
    UnblockSenderPayload,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

mod edges;
mod faults;
mod providers;
mod turns;

async fn start(pool: PgPool, name: &'static str, shard: u32) -> Lab {
    let mut lab = Lab::start_worker_lab(
        pool,
        LabOptions {
            suite: "gmail_ops_worker",
            name,
            shard,
            gmail_label_write_batches: true,
        },
    )
    .await;
    lab.start_workers().await;
    lab
}

fn delivery(lab: &Lab, operation: GmailOpsOperation) -> Delivery {
    Delivery::new(
        serde_json::to_string(&GmailOpsPubsubMessage {
            link_id: lab.fixture.links[0],
            operation,
        })
        .expect("operation JSON"),
    )
}

fn label_operation(
    lab: &Lab,
    names: &[&str],
    write: Option<Uuid>,
    single: bool,
    label: &str,
    add: bool,
) -> GmailOpsOperation {
    let payload = ModifyMessageLabelsBatchPayload {
        messages: names
            .iter()
            .map(|name| GmailMessageRef {
                db_message_id: lab.fixture.messages[*name],
                provider_message_id: (*name).into(),
            })
            .collect(),
        labels_to_add: if add { vec![label.into()] } else { vec![] },
        labels_to_remove: if add { vec![] } else { vec![label.into()] },
        pending_write_id: write,
    };
    if single {
        let message = payload.messages[0].clone();
        GmailOpsOperation::ModifyMessageLabels(ModifyMessageLabelsPayload {
            db_message_id: message.db_message_id,
            provider_message_id: message.provider_message_id,
            labels_to_add: payload.labels_to_add,
            labels_to_remove: payload.labels_to_remove,
            pending_write_id: write,
        })
    } else {
        GmailOpsOperation::ModifyMessageLabelsBatch(payload)
    }
}

fn script(lab: &Lab, method: &str, path: &str, reply: HttpReply) {
    lab.gmail.lock().scripted_http.push_back((
        method.into(),
        format!("/gmail/v1/users/me/{path}"),
        reply,
    ));
}

fn rejection(code: u16) -> HttpReply {
    HttpReply::Status(
        code,
        json!({"error":{"code":code,"message":"scripted provider rejection"}}),
    )
}

#[expect(
    clippy::disallowed_methods,
    reason = "Worker fixtures use runtime SQL without cache entries"
)]
async fn extend_messages(lab: &mut Lab, shard: u32, count: usize) -> Vec<String> {
    let mut names = vec![
        "m1a".into(),
        "m1b".into(),
        "m1c".into(),
        "m2a".into(),
        "m2b".into(),
        "m3a".into(),
    ];
    for index in names.len()..count {
        let name = format!("worker-{index}");
        let id = world::message_uuid(shard, index + 30);
        sqlx::query("INSERT INTO email_messages (id,thread_id,link_id,provider_id,provider_thread_id,is_read,is_starred,is_sent,is_draft,has_attachments) VALUES ($1,$2,$3,$4,'t3',true,false,false,false,false)")
            .bind(id).bind(world::thread_uuid(shard, 2)).bind(lab.fixture.links[0]).bind(&name).execute(&lab.db).await.expect("worker message");
        lab.fixture.messages.insert(name.clone(), id);
        lab.transcript
            .normalizer
            .symbol(id, format!("<msg:{name}>"));
        lab.gmail.lock().messages.insert(
            name.clone(),
            GmailMessage {
                thread_id: "t3".into(),
                labels: Default::default(),
                internal_date_ms: 1_790_000_000_000,
            },
        );
        names.push(name);
    }
    names.truncate(count);
    names
}

#[expect(
    clippy::disallowed_methods,
    reason = "Worker fixtures use runtime SQL without cache entries"
)]
async fn mark(lab: &mut Lab, names: &[&str], write: Uuid, present: bool, label: &str) {
    let ids: Vec<_> = names
        .iter()
        .map(|name| lab.fixture.messages[*name])
        .collect();
    email_db_client::labels::pending_writes::mark_pending_label_writes(
        &lab.db,
        lab.fixture.links[0],
        &ids,
        label,
        present,
        write,
    )
    .await
    .expect("stage marker");
    if present {
        sqlx::query("INSERT INTO email_message_labels (message_id,label_id) SELECT unnest($1::uuid[]),$2 ON CONFLICT DO NOTHING")
            .bind(&ids).bind(lab.fixture.labels[&format!("A/{label}")]).execute(&lab.db).await.expect("stage label add");
    } else {
        sqlx::query("DELETE FROM email_message_labels WHERE message_id=ANY($1) AND label_id=$2")
            .bind(&ids)
            .bind(lab.fixture.labels[&format!("A/{label}")])
            .execute(&lab.db)
            .await
            .expect("stage label remove");
    }
}
