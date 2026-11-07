use super::*;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use tracing::instrument::WithSubscriber;
use tracing_subscriber::{Layer, layer::SubscriberExt};

const LINK: Uuid = Uuid::from_u128(1);
const MESSAGE: Uuid = Uuid::from_u128(2);
const WRITE: Uuid = Uuid::from_u128(3);

#[derive(Debug, PartialEq, Eq)]
enum Call {
    Facts(Vec<Uuid>, Vec<String>, Uuid),
    Mark(Uuid, Vec<Uuid>, String, bool, Uuid),
    Confirm(Vec<Uuid>, Uuid),
    DeleteLabelsFromMessage(Uuid, Vec<String>, Uuid),
    Remove(Vec<Uuid>, Uuid),
    Present(Uuid, Vec<Uuid>, Vec<String>),
    Absent(Uuid, Vec<Uuid>, Vec<String>),
    Flags(Vec<Uuid>),
    Insert(Vec<Uuid>, String, Uuid),
    Delete(Vec<Uuid>, String, Uuid),
    Read(Uuid, Uuid, bool),
    ReadBatch(Vec<Uuid>, Uuid, bool),
    StarredBatch(Vec<Uuid>, Uuid, bool),
    #[cfg(feature = "mailbox")]
    Upsert,
    #[cfg(feature = "mailbox")]
    DeleteRelations(Uuid, Vec<String>),
    #[cfg(feature = "mailbox")]
    DeleteLabels(Uuid, Vec<String>),
}
#[derive(Default)]
struct Fake {
    calls: Vec<Call>,
    fail_at: Option<usize>,
    facts: Vec<LabelWriteFacts>,
    restored: Vec<LabelRestore>,
    count: usize,
    read: Option<Uuid>,
    #[cfg(feature = "mailbox")]
    labels: Vec<Label>,
}
impl Fake {
    fn record(&mut self, call: Call) -> anyhow::Result<()> {
        self.calls.push(call);
        if self.fail_at == Some(self.calls.len()) {
            anyhow::bail!("query failed");
        }
        Ok(())
    }
}
impl PendingLabelQueries for Fake {
    type Err = anyhow::Error;
    async fn facts(
        &mut self,
        messages: &[Uuid],
        labels: &[String],
        write: Uuid,
    ) -> anyhow::Result<Vec<LabelWriteFacts>> {
        self.record(Call::Facts(messages.to_vec(), labels.to_vec(), write))?;
        Ok(std::mem::take(&mut self.facts))
    }
}
impl PendingLabelRestore for Fake {
    type Err = anyhow::Error;
    async fn remove(
        &mut self,
        messages: &[Uuid],
        write: Uuid,
    ) -> anyhow::Result<Vec<LabelRestore>> {
        self.record(Call::Remove(messages.to_vec(), write))?;
        Ok(std::mem::take(&mut self.restored))
    }
    async fn restore_present(
        &mut self,
        link: Uuid,
        messages: &[Uuid],
        labels: &[String],
    ) -> anyhow::Result<()> {
        self.record(Call::Present(link, messages.to_vec(), labels.to_vec()))
    }
    async fn restore_absent(
        &mut self,
        link: Uuid,
        messages: &[Uuid],
        labels: &[String],
    ) -> anyhow::Result<()> {
        self.record(Call::Absent(link, messages.to_vec(), labels.to_vec()))
    }
    async fn refresh_flags(&mut self, messages: &[Uuid]) -> anyhow::Result<()> {
        self.record(Call::Flags(messages.to_vec()))
    }
}
impl PendingLabelMark for Fake {
    type Err = anyhow::Error;
    async fn mark(
        &mut self,
        link: Uuid,
        messages: &[Uuid],
        label: &str,
        present: bool,
        write: Uuid,
    ) -> anyhow::Result<()> {
        self.record(Call::Mark(
            link,
            messages.to_vec(),
            label.into(),
            present,
            write,
        ))
    }
}
impl PendingLabelConfirm for Fake {
    type Err = anyhow::Error;
    async fn confirm(&mut self, messages: &[Uuid], write: Uuid) -> anyhow::Result<()> {
        self.record(Call::Confirm(messages.to_vec(), write))
    }
}
impl MessageLabelQueries for Fake {
    async fn insert(
        &mut self,
        messages: &[Uuid],
        label: &str,
        link: Uuid,
    ) -> anyhow::Result<usize> {
        self.record(Call::Insert(messages.to_vec(), label.into(), link))?;
        Ok(self.count)
    }
    async fn delete(
        &mut self,
        messages: &[Uuid],
        label: &str,
        link: Uuid,
    ) -> anyhow::Result<usize> {
        self.record(Call::Delete(messages.to_vec(), label.into(), link))?;
        Ok(self.count)
    }
    async fn delete_labels(
        &mut self,
        message: Uuid,
        labels: &[String],
        link: Uuid,
    ) -> anyhow::Result<()> {
        self.record(Call::DeleteLabelsFromMessage(
            message,
            labels.to_vec(),
            link,
        ))
    }
    async fn read(
        &mut self,
        message: Uuid,
        link: Uuid,
        read: bool,
    ) -> anyhow::Result<Option<Uuid>> {
        self.record(Call::Read(message, link, read))?;
        Ok(self.read)
    }
    async fn read_batch(
        &mut self,
        messages: Vec<Uuid>,
        link: Uuid,
        read: bool,
    ) -> anyhow::Result<usize> {
        self.record(Call::ReadBatch(messages, link, read))?;
        Ok(self.count)
    }
    async fn starred_batch(
        &mut self,
        messages: Vec<Uuid>,
        link: Uuid,
        starred: bool,
    ) -> anyhow::Result<usize> {
        self.record(Call::StarredBatch(messages, link, starred))?;
        Ok(self.count)
    }
}
#[cfg(feature = "mailbox")]
impl LabelCatalogQueries for Fake {
    async fn upsert(&mut self, labels: Vec<Label>) -> anyhow::Result<()> {
        self.record(Call::Upsert)?;
        self.labels = labels;
        Ok(())
    }
    async fn delete_relations(&mut self, link: Uuid, labels: Vec<String>) -> anyhow::Result<u64> {
        self.record(Call::DeleteRelations(link, labels))?;
        Ok(7)
    }
    async fn delete_labels(&mut self, link: Uuid, labels: Vec<String>) -> anyhow::Result<u64> {
        self.record(Call::DeleteLabels(link, labels))?;
        Ok(11)
    }
}

fn facts(turn: LabelWriteTurn) -> LabelWriteFacts {
    LabelWriteFacts {
        message_id: MESSAGE,
        claimed: turn != LabelWriteTurn::Superseded,
        has_newer: turn == LabelWriteTurn::Wait,
        waits: turn == LabelWriteTurn::Wait,
    }
}

#[tokio::test]
async fn each_fact_condition_and_each_ordered_fold_pair() {
    use LabelWriteTurn::*;
    for (claimed, waits, has_newer, expected) in [
        (false, false, false, Superseded),
        (false, true, true, Superseded),
        (true, true, false, Wait),
        (true, false, true, Superseded),
        (true, false, false, Send),
    ] {
        let mut fake = Fake {
            facts: vec![LabelWriteFacts {
                message_id: MESSAGE,
                claimed,
                waits,
                has_newer,
            }],
            ..Default::default()
        };
        assert_eq!(
            label_write_turns(&mut fake, &[MESSAGE], &["INBOX".into()], WRITE)
                .await
                .unwrap()[&MESSAGE],
            expected
        );
        assert_eq!(
            fake.calls,
            [Call::Facts(vec![MESSAGE], vec!["INBOX".into()], WRITE)]
        );
    }
    for (a, b, expected) in [
        (Send, Send, Send),
        (Send, Wait, Wait),
        (Send, Superseded, Superseded),
        (Wait, Send, Wait),
        (Wait, Wait, Wait),
        (Wait, Superseded, Wait),
        (Superseded, Send, Superseded),
        (Superseded, Wait, Wait),
        (Superseded, Superseded, Superseded),
    ] {
        let mut fake = Fake {
            facts: vec![facts(a), facts(b)],
            ..Default::default()
        };
        assert_eq!(
            label_write_turns(&mut fake, &[MESSAGE], &[], WRITE)
                .await
                .unwrap()[&MESSAGE],
            expected
        );
    }
    let mut fake = Fake::default();
    assert!(
        label_write_turns(&mut fake, &[], &[], WRITE)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(fake.calls.len(), 1); // even empty reads execute the original statement
    let mut fake = Fake {
        fail_at: Some(1),
        ..Default::default()
    };
    assert_eq!(
        label_write_turns(&mut fake, &[MESSAGE], &[], WRITE)
            .await
            .unwrap_err()
            .to_string(),
        "query failed"
    );
}

fn restores() -> Vec<LabelRestore> {
    vec![
        LabelRestore {
            message_id: WRITE,
            provider_label_id: "STARRED".into(),
            label_present: false,
        },
        LabelRestore {
            message_id: MESSAGE,
            provider_label_id: "UNREAD".into(),
            label_present: true,
        },
        LabelRestore {
            message_id: WRITE,
            provider_label_id: "INBOX".into(),
            label_present: true,
        },
    ]
}
fn restoration_calls() -> Vec<Call> {
    vec![
        Call::Remove(vec![MESSAGE, WRITE], WRITE),
        Call::Present(
            LINK,
            vec![MESSAGE, WRITE],
            vec!["UNREAD".into(), "INBOX".into()],
        ),
        Call::Absent(LINK, vec![WRITE], vec!["STARRED".into()]),
        Call::Flags(vec![MESSAGE, WRITE]),
    ]
}
#[tokio::test]
async fn restoration_partitions_then_sorts_and_deduplicates_and_stops_at_each_failure() {
    let mut fake = Fake {
        restored: restores(),
        ..Default::default()
    };
    assert_eq!(
        abandon_pending_label_writes(&mut fake, LINK, &[MESSAGE, WRITE], WRITE)
            .await
            .unwrap(),
        [MESSAGE, WRITE]
    );
    assert_eq!(fake.calls, restoration_calls());
    for fail_at in 1..=4 {
        let mut fake = Fake {
            restored: restores(),
            fail_at: Some(fail_at),
            ..Default::default()
        };
        assert_eq!(
            abandon_pending_label_writes(&mut fake, LINK, &[MESSAGE, WRITE], WRITE)
                .await
                .unwrap_err()
                .to_string(),
            "query failed"
        );
        assert_eq!(fake.calls, restoration_calls()[..fail_at]);
    }
}
#[tokio::test]
async fn restoration_empty_request_empty_result_and_empty_partitions_are_distinct() {
    let mut fake = Fake::default();
    assert!(
        abandon_pending_label_writes(&mut fake, LINK, &[], WRITE)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(fake.calls.is_empty());
    assert!(
        abandon_pending_label_writes(&mut fake, LINK, &[MESSAGE], WRITE)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(fake.calls, [Call::Remove(vec![MESSAGE], WRITE)]);
    for present in [true, false] {
        let mut fake = Fake {
            restored: vec![LabelRestore {
                message_id: MESSAGE,
                provider_label_id: "INBOX".into(),
                label_present: present,
            }],
            ..Default::default()
        };
        abandon_pending_label_writes(&mut fake, LINK, &[MESSAGE], WRITE)
            .await
            .unwrap();
        assert_eq!(fake.calls.len(), 4); // both mutation statements run even for an empty partition
        assert_eq!(
            fake.calls[1],
            Call::Present(
                LINK,
                if present { vec![MESSAGE] } else { vec![] },
                if present {
                    vec!["INBOX".into()]
                } else {
                    vec![]
                }
            )
        );
        assert_eq!(
            fake.calls[2],
            Call::Absent(
                LINK,
                if present { vec![] } else { vec![MESSAGE] },
                if present {
                    vec![]
                } else {
                    vec!["INBOX".into()]
                }
            )
        );
    }
}
#[tokio::test]
async fn batch_validation_preserves_empty_request_precedence_and_each_query_error() {
    for insert in [true, false] {
        for (ids, label, outcome) in [
            (vec![], "", Ok(0)),
            (vec![], "INBOX", Ok(0)),
            (vec![MESSAGE], "", Err("Provider label ID cannot be empty")),
            (vec![MESSAGE], "INBOX", Ok(5)),
        ] {
            let mut fake = Fake {
                count: 5,
                ..Default::default()
            };
            let result = if insert {
                insert_message_labels_batch(&mut fake, &ids, label, LINK).await
            } else {
                delete_message_labels_batch(&mut fake, &ids, label, LINK).await
            };
            assert_eq!(
                result.map_err(|e| e.to_string()),
                outcome.map_err(str::to_owned)
            );
            assert_eq!(
                fake.calls.len(),
                usize::from(!ids.is_empty() && !label.is_empty())
            );
        }
        let mut fake = Fake {
            fail_at: Some(1),
            ..Default::default()
        };
        let result = if insert {
            insert_message_labels_batch(&mut fake, &vec![MESSAGE], "INBOX", LINK).await
        } else {
            delete_message_labels_batch(&mut fake, &vec![MESSAGE], "INBOX", LINK).await
        };
        assert_eq!(result.unwrap_err().to_string(), "query failed");
    }
}
#[tokio::test]
async fn read_and_starred_counts_preserve_the_zero_count_difference() {
    for starred in [true, false] {
        let mut fake = Fake::default();
        let result = if starred {
            update_message_starred_status_batch(&mut fake, vec![], LINK, true).await
        } else {
            update_message_read_status_batch(&mut fake, vec![], LINK, true).await
        };
        assert_eq!(result.unwrap(), 0);
        assert!(fake.calls.is_empty());
        for count in [0, 1, 2] {
            let mut fake = Fake {
                count,
                ..Default::default()
            };
            let result = if starred {
                update_message_starred_status_batch(&mut fake, vec![MESSAGE, WRITE], LINK, false)
                    .await
            } else {
                update_message_read_status_batch(&mut fake, vec![MESSAGE, WRITE], LINK, false).await
            };
            if !starred && count == 0 {
                assert_eq!(
                    result.unwrap_err().to_string(),
                    format!(
                        "no messages updated for link {LINK}: none of the 2 requested ids belong to it"
                    )
                );
            } else {
                assert_eq!(result.unwrap(), count);
            }
            assert_eq!(
                fake.calls,
                [if starred {
                    Call::StarredBatch(vec![MESSAGE, WRITE], LINK, false)
                } else {
                    Call::ReadBatch(vec![MESSAGE, WRITE], LINK, false)
                }]
            );
        }
        let mut fake = Fake {
            fail_at: Some(1),
            ..Default::default()
        };
        let result = if starred {
            update_message_starred_status_batch(&mut fake, vec![MESSAGE], LINK, true).await
        } else {
            update_message_read_status_batch(&mut fake, vec![MESSAGE], LINK, true).await
        };
        assert_eq!(result.unwrap_err().to_string(), "query failed");
    }
    for read in [None, Some(MESSAGE)] {
        let mut fake = Fake {
            read,
            ..Default::default()
        };
        assert_eq!(
            update_message_read_status(&mut fake, MESSAGE, LINK, false)
                .await
                .unwrap(),
            read
        );
        assert_eq!(fake.calls, [Call::Read(MESSAGE, LINK, false)]);
    }
    let mut fake = Fake {
        fail_at: Some(1),
        ..Default::default()
    };
    assert_eq!(
        update_message_read_status(&mut fake, MESSAGE, LINK, true)
            .await
            .unwrap_err()
            .to_string(),
        "query failed"
    );
}

type Event = (String, BTreeMap<String, String>);

#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<Event>>>);
#[derive(Default)]
struct Fields(BTreeMap<String, String>);
impl tracing::field::Visit for Fields {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().into(), format!("{value:?}"));
    }
}
impl<S: tracing::Subscriber> Layer<S> for Capture {
    fn on_event(&self, event: &tracing::Event<'_>, _: tracing_subscriber::layer::Context<'_, S>) {
        let mut fields = Fields::default();
        event.record(&mut fields);
        self.0
            .lock()
            .unwrap()
            .push((event.metadata().level().to_string(), fields.0));
    }
}

#[cfg(feature = "mailbox")]
#[tokio::test]
async fn catalog_guards_ids_order_failures_and_exact_debug_event() {
    let mut fake = Fake::default();
    insert_or_update_labels(&mut fake, vec![]).await.unwrap();
    assert_eq!(
        delete_labels_by_provider_ids(&mut fake, LINK, vec![])
            .await
            .unwrap(),
        0
    );
    assert!(fake.calls.is_empty());
    let label = Label {
        id: None,
        link_id: LINK,
        provider_label_id: "INBOX".into(),
        name: None,
        created_at: chrono::DateTime::UNIX_EPOCH,
        message_list_visibility: None,
        label_list_visibility: None,
        type_: None,
    };
    let mut existing = label.clone();
    existing.id = Some(WRITE);
    insert_or_update_labels(&mut fake, vec![label.clone(), existing])
        .await
        .unwrap();
    assert!(fake.labels[0].id.is_some());
    assert_eq!(fake.labels[1].id, Some(WRITE));
    assert_eq!(fake.labels[0].provider_label_id, label.provider_label_id);
    let mut fake = Fake {
        fail_at: Some(1),
        ..Default::default()
    };
    assert_eq!(
        insert_or_update_labels(&mut fake, vec![label])
            .await
            .unwrap_err()
            .to_string(),
        "query failed"
    );
    for fail_at in [None, Some(1), Some(2)] {
        let mut fake = Fake {
            fail_at,
            ..Default::default()
        };
        let capture = Capture::default();
        let result =
            delete_labels_by_provider_ids(&mut fake, LINK, vec!["INBOX".into(), "STARRED".into()])
                .with_subscriber(tracing_subscriber::registry().with(capture.clone()))
                .await;
        if fail_at.is_some() {
            assert_eq!(result.unwrap_err().to_string(), "query failed");
        } else {
            assert_eq!(result.unwrap(), 11);
        }
        let calls = [
            Call::DeleteRelations(LINK, vec!["INBOX".into(), "STARRED".into()]),
            Call::DeleteLabels(LINK, vec!["INBOX".into(), "STARRED".into()]),
        ];
        assert_eq!(fake.calls, calls[..if fail_at == Some(1) { 1 } else { 2 }]);
        let seen = capture.0.lock().unwrap();
        let debug: Vec<_> = seen.iter().filter(|(level, _)| level == "DEBUG").collect();
        if fail_at == Some(1) {
            assert!(debug.is_empty());
        } else {
            assert_eq!(
                debug,
                vec![&(
                    "DEBUG".into(),
                    BTreeMap::from([
                        (
                            "message".into(),
                            "Deleted message_labels entries that referenced the labels".into()
                        ),
                        ("link_id".into(), LINK.to_string()),
                        ("provider_label_count".into(), "2".into()),
                        ("deleted_message_labels_count".into(), "7".into()),
                    ])
                )]
            );
        }
    }
}

#[tokio::test]
async fn read_and_starred_warnings_keep_their_exact_fields() {
    for single in [true, false] {
        let mut fake = Fake {
            count: 1,
            ..Default::default()
        };
        let capture = Capture::default();
        async {
            if single {
                update_message_read_status(&mut fake, MESSAGE, LINK, true)
                    .await
                    .unwrap();
            } else {
                update_message_read_status_batch(&mut fake, vec![MESSAGE, WRITE], LINK, false)
                    .await
                    .unwrap();
            }
        }
        .with_subscriber(tracing_subscriber::registry().with(capture.clone()))
        .await;
        let fields = if single {
            BTreeMap::from([
                (
                    "message".into(),
                    "No message was updated - message may not exist or doesn't belong to the inbox"
                        .into(),
                ),
                ("message_id".into(), MESSAGE.to_string()),
                ("link_id".into(), LINK.to_string()),
            ])
        } else {
            BTreeMap::from([
                ("message".into(), "Some messages were not updated - they may not exist or don't belong to the inbox".into()),
                ("requested_count".into(), "2".into()), ("updated_count".into(), "1".into()),
                ("link_id".into(), LINK.to_string()),
            ])
        };
        assert_eq!(*capture.0.lock().unwrap(), vec![("WARN".into(), fields)]);
    }
    let mut fake = Fake::default();
    let capture = Capture::default();
    update_message_starred_status_batch(&mut fake, vec![MESSAGE], LINK, true)
        .with_subscriber(tracing_subscriber::registry().with(capture.clone()))
        .await
        .unwrap();
    assert_eq!(*capture.0.lock().unwrap(), vec![("WARN".into(), BTreeMap::from([
        ("message".into(), "Some messages were not updated - they may not exist or don't belong to the inbox".into()),
        ("requested_count".into(), "1".into()), ("updated_count".into(), "0".into()),
        ("link_id".into(), LINK.to_string()),
    ]))]);
}

#[tokio::test]
async fn pending_mutation_and_label_delete_guards_preserve_query_arguments_and_errors() {
    let mut fake = Fake::default();
    mark_pending_label_writes(&mut fake, LINK, &[], "", false, WRITE)
        .await
        .unwrap();
    confirm_pending_label_writes(&mut fake, &[], WRITE)
        .await
        .unwrap();
    delete_db_message_labels(&mut fake, MESSAGE, &[], LINK)
        .await
        .unwrap();
    assert!(fake.calls.is_empty());
    mark_pending_label_writes(&mut fake, LINK, &[MESSAGE, MESSAGE], "", false, WRITE)
        .await
        .unwrap();
    confirm_pending_label_writes(&mut fake, &[MESSAGE, MESSAGE], WRITE)
        .await
        .unwrap();
    delete_db_message_labels(&mut fake, MESSAGE, &["INBOX".into()], LINK)
        .await
        .unwrap();
    assert_eq!(
        fake.calls,
        [
            Call::Mark(LINK, vec![MESSAGE, MESSAGE], "".into(), false, WRITE),
            Call::Confirm(vec![MESSAGE, MESSAGE], WRITE),
            Call::DeleteLabelsFromMessage(MESSAGE, vec!["INBOX".into()], LINK)
        ]
    );
    for step in 0..3 {
        let mut fake = Fake {
            fail_at: Some(1),
            ..Default::default()
        };
        let result = match step {
            0 => mark_pending_label_writes(&mut fake, LINK, &[MESSAGE], "INBOX", true, WRITE).await,
            1 => confirm_pending_label_writes(&mut fake, &[MESSAGE], WRITE).await,
            _ => delete_db_message_labels(&mut fake, MESSAGE, &["INBOX".into()], LINK).await,
        };
        assert_eq!(result.unwrap_err().to_string(), "query failed");
        assert_eq!(fake.calls.len(), 1);
    }
}
