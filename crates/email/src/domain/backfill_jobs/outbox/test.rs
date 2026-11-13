use super::*;

#[test]
fn maps_email_completion_outbox() {
    let row = EmailCompletionOutboxRow {
        id: Uuid::now_v7(),
        backfill_job_id: Uuid::now_v7(),
        email_link_id: Some(Uuid::now_v7()),
    };

    let BackfillOperation::FinalizeBackfill(scope) = to_email_completion_message(&row)
        .unwrap()
        .backfill_operation
    else {
        panic!("expected finalize-backfill operation");
    };
    assert_eq!(scope.job_id, row.backfill_job_id);
    assert_eq!(Some(scope.link_id), row.email_link_id);
}

#[test]
fn skips_email_completion_when_link_was_deleted() {
    let row = EmailCompletionOutboxRow {
        id: Uuid::now_v7(),
        backfill_job_id: Uuid::now_v7(),
        email_link_id: None,
    };

    assert!(to_email_completion_message(&row).is_none());
}

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
enum Row {
    Init(EmailInitOutboxRow),
    Completion(EmailCompletionOutboxRow),
    Crm(CrmOutboxRow),
}
#[derive(Default)]
struct State {
    rows: VecDeque<Row>,
    calls: Vec<&'static str>,
    fault: Option<(&'static str, usize)>,
    active: bool,
    messages: Vec<BackfillPubsubMessage>,
    enabled: bool,
    parents: Vec<Option<String>>,
}
#[derive(Clone, Default)]
struct Fake(Arc<Mutex<State>>);
impl Fake {
    fn call(&self, name: &'static str) -> anyhow::Result<()> {
        let mut s = self.0.lock().unwrap();
        s.calls.push(name);
        if s.fault == Some((name, s.calls.iter().filter(|v| **v == name).count())) {
            anyhow::bail!("{name} failed");
        }
        Ok(())
    }
    fn tx(&self) -> anyhow::Result<Tx> {
        self.call("begin")?;
        self.0.lock().unwrap().active = true;
        Ok(Tx {
            f: self.clone(),
            marked: false,
            committed: false,
        })
    }
    fn calls(&self) -> Vec<&'static str> {
        self.0.lock().unwrap().calls.clone()
    }
}
struct Tx {
    f: Fake,
    marked: bool,
    committed: bool,
}
impl Drop for Tx {
    fn drop(&mut self) {
        let mut s = self.f.0.lock().unwrap();
        s.active = false;
        if !self.committed {
            s.calls.push("rollback");
        }
    }
}
impl BackfillOutboxRepository for Fake {
    type Init = Tx;
    type Completion = Tx;
    type Crm = Tx;
    async fn init(&self) -> anyhow::Result<Tx> {
        self.tx()
    }
    async fn completion(&self) -> anyhow::Result<Tx> {
        self.tx()
    }
    async fn crm(&self) -> anyhow::Result<Tx> {
        self.tx()
    }
}
impl OutboxTransaction for Tx {
    async fn commit(mut self) -> anyhow::Result<()> {
        self.f.call("commit")?;
        if self.marked {
            self.f.0.lock().unwrap().rows.pop_front();
        }
        self.committed = true;
        Ok(())
    }
}
impl InitOutboxTransaction for Tx {
    async fn next(&mut self) -> anyhow::Result<Option<EmailInitOutboxRow>> {
        self.f.call("next")?;
        Ok(match self.f.0.lock().unwrap().rows.front() {
            Some(Row::Init(r)) => Some(r.clone()),
            None => None,
            _ => panic!("kind"),
        })
    }
    async fn published(&mut self, _: Uuid) -> anyhow::Result<()> {
        self.f.call("mark")?;
        self.marked = true;
        Ok(())
    }
}
impl CompletionOutboxTransaction for Tx {
    async fn next(&mut self) -> anyhow::Result<Option<EmailCompletionOutboxRow>> {
        self.f.call("next")?;
        Ok(match self.f.0.lock().unwrap().rows.front() {
            Some(Row::Completion(r)) => Some(r.clone()),
            None => None,
            _ => panic!("kind"),
        })
    }
    async fn published(&mut self, _: Uuid, retire: bool) -> anyhow::Result<()> {
        self.f.call(if retire { "retire" } else { "mark" })?;
        self.marked = true;
        Ok(())
    }
}
impl CrmOutboxTransaction for Tx {
    async fn next(&mut self) -> anyhow::Result<Option<CrmOutboxRow>> {
        self.f.call("next")?;
        Ok(match self.f.0.lock().unwrap().rows.front() {
            Some(Row::Crm(r)) => Some(r.clone()),
            None => None,
            _ => panic!("kind"),
        })
    }
    async fn enabled(&mut self, _: &CrmOutboxRow) -> anyhow::Result<bool> {
        self.f.call("enabled")?;
        Ok(self.f.0.lock().unwrap().enabled)
    }
    async fn delete(&mut self, _: &CrmOutboxRow) -> anyhow::Result<()> {
        self.f.call("delete")?;
        self.marked = true;
        Ok(())
    }
}
impl BackfillOutboxPublisher for Fake {
    async fn publish(&self, message: BackfillPubsubMessage) -> anyhow::Result<()> {
        assert!(self.0.lock().unwrap().active, "row lock held across send");
        self.call("publish")?;
        self.0.lock().unwrap().messages.push(message);
        Ok(())
    }
    fn adopt(&self, _: &tracing::Span, parent: Option<&str>) {
        self.call("adopt").unwrap();
        self.0
            .lock()
            .unwrap()
            .parents
            .push(parent.map(str::to_owned));
    }
}
fn init_row() -> Row {
    Row::Init(EmailInitOutboxRow {
        id: Uuid::from_u128(1),
        backfill_job_id: Uuid::from_u128(2),
        email_link_id: Uuid::from_u128(3),
        priority_pass: true,
        refresh_existing: false,
    })
}
fn completion_row(link: bool) -> Row {
    Row::Completion(EmailCompletionOutboxRow {
        id: Uuid::from_u128(1),
        backfill_job_id: Uuid::from_u128(2),
        email_link_id: link.then(|| Uuid::from_u128(3)),
    })
}
fn crm_row() -> Row {
    Row::Crm(CrmOutboxRow {
        team_id: Uuid::from_u128(1),
        user_id: "macro|owner@example.com".into(),
        traceparent: Some("parent".into()),
    })
}
fn queued(row: Row) -> Fake {
    let f = Fake::default();
    f.0.lock().unwrap().rows.push_back(row);
    f
}

#[tokio::test]
async fn init_publication_holds_lock_and_marks_before_commit() {
    let f = queued(init_row());
    assert_eq!(drain_email_init(&f, &f).await.unwrap(), 1);
    assert_eq!(
        f.calls(),
        [
            "begin", "next", "publish", "mark", "commit", "begin", "next", "commit"
        ]
    );
    let s = f.0.lock().unwrap();
    let BackfillOperation::ListThreads(scope) = &s.messages[0].backfill_operation else {
        panic!("init")
    };
    assert_eq!(scope.job_id, Uuid::from_u128(2));
    assert_eq!(scope.link_id, Uuid::from_u128(3));
    assert!(scope.payload.priority_pass);
    assert!(!scope.payload.refresh_existing);
    assert!(scope.payload.next_page_token.is_none());
}
#[tokio::test]
async fn completion_with_deleted_link_retires_without_sending() {
    let f = queued(completion_row(false));
    assert_eq!(drain_email_completion(&f, &f).await.unwrap(), 1);
    assert_eq!(
        f.calls(),
        [
            "begin", "next", "retire", "commit", "begin", "next", "commit"
        ]
    );
    assert!(f.0.lock().unwrap().messages.is_empty());
    let f = queued(completion_row(true));
    assert_eq!(drain_email_completion(&f, &f).await.unwrap(), 1);
    assert_eq!(
        f.calls(),
        [
            "begin", "next", "publish", "mark", "commit", "begin", "next", "commit"
        ]
    );
}
#[tokio::test]
async fn each_email_outbox_failure_leaves_the_row_for_retry() {
    for kind in [false, true] {
        for fault in ["begin", "next", "publish", "mark", "commit"] {
            let f = queued(if kind {
                completion_row(true)
            } else {
                init_row()
            });
            f.0.lock().unwrap().fault = Some((fault, 1));
            let result = if kind {
                drain_email_completion(&f, &f).await
            } else {
                drain_email_init(&f, &f).await
            };
            assert!(result.is_err());
            assert_eq!(f.0.lock().unwrap().rows.len(), 1);
            assert_eq!(f.calls().contains(&"rollback"), fault != "begin");
            f.0.lock().unwrap().fault = None;
            assert_eq!(
                if kind {
                    drain_email_completion(&f, &f).await.unwrap()
                } else {
                    drain_email_init(&f, &f).await.unwrap()
                },
                1
            );
            assert!(f.0.lock().unwrap().rows.is_empty());
        }
    }
}
#[tokio::test]
async fn partial_publication_keeps_prior_commits_and_retries_only_the_failed_row() {
    let f = queued(init_row());
    f.0.lock().unwrap().rows.push_back(init_row());
    f.0.lock().unwrap().fault = Some(("publish", 2));
    assert!(drain_email_init(&f, &f).await.is_err());
    assert_eq!(f.0.lock().unwrap().rows.len(), 1);
    assert_eq!(f.0.lock().unwrap().messages.len(), 1);
    f.0.lock().unwrap().fault = None;
    assert_eq!(drain_email_init(&f, &f).await.unwrap(), 1);
    assert_eq!(f.0.lock().unwrap().messages.len(), 2);
}
#[tokio::test]
async fn each_drain_preserves_the_fifty_row_batch_cap() {
    for kind in [0, 1, 2] {
        let f = Fake::default();
        {
            let mut s = f.0.lock().unwrap();
            s.enabled = true;
            for _ in 0..51 {
                s.rows.push_back(match kind {
                    0 => init_row(),
                    1 => completion_row(true),
                    _ => crm_row(),
                });
            }
        }
        match kind {
            0 => assert_eq!(drain_email_init(&f, &f).await.unwrap(), 50),
            1 => assert_eq!(drain_email_completion(&f, &f).await.unwrap(), 50),
            _ => drain_crm(&f, &f).await.unwrap(),
        };
        assert_eq!(f.0.lock().unwrap().rows.len(), 1);
        assert_eq!(f.0.lock().unwrap().messages.len(), 50);
    }
}
#[tokio::test]
async fn crm_restores_trace_checks_consent_then_sends_deletes_and_commits() {
    let f = queued(crm_row());
    f.0.lock().unwrap().enabled = true;
    drain_crm(&f, &f).await.unwrap();
    assert_eq!(
        f.calls(),
        [
            "begin", "next", "adopt", "enabled", "publish", "delete", "commit", "begin", "next",
            "rollback"
        ]
    );
    let s = f.0.lock().unwrap();
    assert_eq!(s.parents, [Some("parent".into())]);
    let BackfillOperation::PopulateCrmForUser(p) = &s.messages[0].backfill_operation else {
        panic!("crm")
    };
    assert_eq!(p.macro_id.as_ref(), "macro|owner@example.com");
}
#[tokio::test]
async fn withdrawn_crm_request_is_deleted_without_sending() {
    let f = queued(crm_row());
    drain_crm(&f, &f).await.unwrap();
    assert!(f.0.lock().unwrap().messages.is_empty());
    assert_eq!(
        f.calls(),
        [
            "begin", "next", "adopt", "enabled", "delete", "commit", "begin", "next", "rollback"
        ]
    );
}
#[tokio::test]
async fn crm_failure_keeps_the_locked_row_for_retry() {
    for fault in ["begin", "next", "enabled", "publish", "delete", "commit"] {
        let f = queued(crm_row());
        {
            let mut s = f.0.lock().unwrap();
            s.enabled = true;
            s.fault = Some((fault, 1));
        }
        assert!(drain_crm(&f, &f).await.is_err());
        assert_eq!(f.0.lock().unwrap().rows.len(), 1);
        assert_eq!(f.calls().contains(&"rollback"), fault != "begin");
    }
}
#[tokio::test]
async fn malformed_crm_owner_fails_only_when_current_consent_is_enabled() {
    for enabled in [true, false] {
        let f = queued(Row::Crm(CrmOutboxRow {
            team_id: Uuid::nil(),
            user_id: "invalid".into(),
            traceparent: None,
        }));
        f.0.lock().unwrap().enabled = enabled;
        assert_eq!(drain_crm(&f, &f).await.is_err(), enabled);
        assert_eq!(f.0.lock().unwrap().rows.len(), usize::from(enabled));
        assert!(f.0.lock().unwrap().messages.is_empty());
    }
}

#[tokio::test]
async fn deleted_link_retirement_failure_rolls_back_without_a_send() {
    let f = queued(completion_row(false));
    f.0.lock().unwrap().fault = Some(("retire", 1));
    assert!(drain_email_completion(&f, &f).await.is_err());
    assert_eq!(f.calls(), ["begin", "next", "retire", "rollback"]);
    assert_eq!(f.0.lock().unwrap().rows.len(), 1);
    assert!(f.0.lock().unwrap().messages.is_empty());
}
