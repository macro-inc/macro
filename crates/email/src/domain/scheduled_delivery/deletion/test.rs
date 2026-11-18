use super::*;
use std::sync::{Arc, Mutex};

const LINK: Uuid = Uuid::from_u128(1);
const MESSAGE: Uuid = Uuid::from_u128(2);
const THREAD: Uuid = Uuid::from_u128(3);
#[derive(Clone)]
struct Fake {
    trace: Arc<Mutex<Vec<&'static str>>>,
    fail: Option<&'static str>,
    message: bool,
    deferred: bool,
    retained: bool,
    generation: i32,
    provider: Option<String>,
    current_provider: Option<String>,
    active: bool,
    deleted: bool,
    empty: bool,
    draft: bool,
}
impl Fake {
    fn ready() -> Self {
        Self {
            trace: Arc::default(),
            fail: None,
            message: true,
            deferred: true,
            retained: true,
            generation: 7,
            provider: Some("provider".into()),
            current_provider: Some("provider".into()),
            active: false,
            deleted: true,
            empty: false,
            draft: false,
        }
    }
    fn step(&self, name: &'static str) -> anyhow::Result<()> {
        self.trace.lock().unwrap().push(name);
        anyhow::ensure!(self.fail != Some(name), "{name} failed");
        Ok(())
    }
    fn trace(&self) -> Vec<&'static str> {
        self.trace.lock().unwrap().clone()
    }
}
struct Tx {
    fake: Fake,
    committed: bool,
}
impl Drop for Tx {
    fn drop(&mut self) {
        if !self.committed {
            self.fake.trace.lock().unwrap().push("drop");
        }
    }
}
impl DeletionStore for Fake {
    type Transaction = Tx;
    async fn begin(&self) -> anyhow::Result<Tx> {
        self.step("begin")?;
        Ok(Tx {
            fake: self.clone(),
            committed: false,
        })
    }
}
impl DeletionTransaction for Tx {
    type Queries = Fake;
    fn queries(&mut self) -> &mut Fake {
        &mut self.fake
    }
    async fn commit(mut self) -> anyhow::Result<()> {
        self.fake.step("commit")?;
        self.committed = true;
        Ok(())
    }
}
impl DeletionQueries for Fake {
    async fn delete_message(&mut self, message: Uuid) -> anyhow::Result<bool> {
        assert_eq!(message, MESSAGE);
        self.step("delete")?;
        Ok(self.deleted)
    }
    async fn has_deferred(&mut self, message: Uuid) -> anyhow::Result<bool> {
        assert_eq!(message, MESSAGE);
        self.step("has_deferred")?;
        Ok(self.retained)
    }
    async fn lock_thread(&mut self, thread: Uuid) -> anyhow::Result<()> {
        assert_eq!(thread, THREAD);
        self.step("lock_thread")
    }
    async fn metadata(&mut self, thread: Uuid, link: Uuid) -> anyhow::Result<()> {
        assert_eq!((thread, link), (THREAD, LINK));
        self.step("metadata")
    }
    async fn attachment_flags(&mut self, thread: Uuid) -> anyhow::Result<()> {
        assert_eq!(thread, THREAD);
        self.step("flags")
    }
    async fn message(
        &mut self,
        message: Uuid,
        link: Uuid,
    ) -> anyhow::Result<Option<DeletionMessage>> {
        assert_eq!((message, link), (MESSAGE, LINK));
        self.step("message")?;
        Ok(self.message.then_some(DeletionMessage {
            thread_id: THREAD,
            provider_id: self.current_provider.clone(),
            draft_generation: 7,
            is_draft: self.draft,
        }))
    }
    async fn deferred(&mut self, message: Uuid) -> anyhow::Result<Option<DeferredDeletion>> {
        assert_eq!(message, MESSAGE);
        self.step("deferred")?;
        Ok(self.deferred.then(|| DeferredDeletion {
            provider_id: self.provider.clone(),
            draft_generation: self.generation,
        }))
    }
    async fn remove_deferred(&mut self, message: Uuid) -> anyhow::Result<()> {
        assert_eq!(message, MESSAGE);
        self.step("remove_deferred")
    }
    async fn active_attempt(&mut self, message: Uuid, link: Uuid) -> anyhow::Result<bool> {
        assert_eq!((message, link), (MESSAGE, LINK));
        self.step("active")?;
        Ok(self.active)
    }
    async fn recipients(&mut self, message: Uuid) -> anyhow::Result<Vec<String>> {
        assert_eq!(message, MESSAGE);
        self.step("recipients")?;
        Ok(vec!["recipient@example.com".into()])
    }
    async fn cleanup_contacts(&mut self, link: Uuid, emails: &[String]) -> anyhow::Result<()> {
        assert_eq!(link, LINK);
        assert_eq!(emails, ["recipient@example.com"]);
        self.step("cleanup")
    }
}
#[tokio::test]
async fn missing_message_or_deferred_marker_and_active_send_drop_without_commit() {
    for branch in ["message", "deferred", "active"] {
        let mut fake = Fake::ready();
        match branch {
            "message" => fake.message = false,
            "deferred" => fake.deferred = false,
            _ => fake.active = true,
        }
        assert!(
            reconcile_deferred_deletion(&fake, LINK, MESSAGE)
                .await
                .unwrap()
                .is_none()
        );
        let expected = match branch {
            "message" => vec!["begin", "message", "drop"],
            "deferred" => vec!["begin", "message", "deferred", "drop"],
            _ => vec!["begin", "message", "deferred", "active", "drop"],
        };
        assert_eq!(fake.trace(), expected);
    }
}
#[tokio::test]
async fn each_identity_mismatch_retires_the_marker_before_checking_active_delivery() {
    for mismatch in ["generation", "provider"] {
        let mut fake = Fake::ready();
        if mismatch == "generation" {
            fake.generation = 8;
        } else {
            fake.provider = Some("other".into());
        }
        fake.active = true;
        assert!(
            reconcile_deferred_deletion(&fake, LINK, MESSAGE)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            fake.trace(),
            ["begin", "message", "deferred", "remove_deferred", "commit"]
        );
    }
}
#[tokio::test]
async fn retained_or_already_missing_deletes_still_commit_cleanup_without_publication() {
    for deferred in [false, true] {
        let mut fake = Fake::ready();
        fake.deleted = false;
        // The initial marker exists; simulate the outcome changing at DELETE via the query fake.
        fake.deferred = true;
        fake.retained = deferred;
        assert!(
            reconcile_deferred_deletion(&fake, LINK, MESSAGE)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            fake.trace(),
            [
                "begin",
                "message",
                "deferred",
                "active",
                "recipients",
                "delete",
                "has_deferred",
                "cleanup",
                "commit"
            ]
        );
        let mut direct = fake.clone();
        direct.retained = deferred;
        assert_eq!(
            delete_message_in_thread(&mut direct, MESSAGE, THREAD, LINK, false)
                .await
                .unwrap(),
            if deferred {
                MessageDeletion::Deferred
            } else {
                MessageDeletion::AlreadyDeleted
            }
        );
    }
}
#[tokio::test]
async fn surviving_threads_refresh_metadata_and_only_non_drafts_refresh_attachment_flags() {
    for empty in [false, true] {
        for draft in [false, true] {
            let mut fake = Fake::ready();
            fake.empty = empty;
            fake.draft = draft;
            let deleted = reconcile_deferred_deletion(&fake, LINK, MESSAGE)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(deleted.thread_id, THREAD);
            assert_eq!(deleted.provider_id, "provider");
            let mut expected = vec![
                "begin",
                "message",
                "deferred",
                "active",
                "recipients",
                "delete",
                "lock_thread",
                "thread_has_messages",
            ];
            if empty {
                expected.push("delete_thread");
            }
            if !empty {
                expected.push("metadata");
            }
            if !empty && !draft {
                expected.push("flags");
            }
            expected.extend(["cleanup", "commit"]);
            assert_eq!(fake.trace(), expected);
        }
    }
}
#[tokio::test]
async fn every_storage_failure_keeps_the_original_error_and_drops_without_a_later_write() {
    for fail in [
        "begin",
        "message",
        "deferred",
        "active",
        "recipients",
        "delete",
        "lock_thread",
        "thread_has_messages",
        "metadata",
        "flags",
        "cleanup",
        "commit",
    ] {
        let mut fake = Fake::ready();
        fake.fail = Some(fail);
        assert_eq!(
            reconcile_deferred_deletion(&fake, LINK, MESSAGE)
                .await
                .err()
                .unwrap()
                .to_string(),
            format!("{fail} failed")
        );
        let trace = fake.trace();
        assert_eq!(
            trace.last(),
            Some(if fail == "begin" { &"begin" } else { &"drop" })
        );
        if fail != "begin" {
            assert_eq!(trace[trace.len() - 2], fail);
        }
    }
    let mut fake = Fake::ready();
    fake.generation = 8;
    fake.fail = Some("remove_deferred");
    assert_eq!(
        reconcile_deferred_deletion(&fake, LINK, MESSAGE)
            .await
            .err()
            .unwrap()
            .to_string(),
        "remove_deferred failed"
    );
    assert_eq!(
        fake.trace(),
        ["begin", "message", "deferred", "remove_deferred", "drop"]
    );
    let mut fake = Fake::ready();
    fake.deleted = false;
    fake.fail = Some("has_deferred");
    assert_eq!(
        reconcile_deferred_deletion(&fake, LINK, MESSAGE)
            .await
            .err()
            .unwrap()
            .to_string(),
        "has_deferred failed"
    );
    assert_eq!(fake.trace().last(), Some(&"drop"));
}

#[tokio::test]
async fn matching_absent_provider_id_resolves_to_the_existing_empty_publication_identity() {
    let mut fake = Fake::ready();
    fake.provider = None;
    fake.current_provider = None;
    let deleted = reconcile_deferred_deletion(&fake, LINK, MESSAGE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(deleted.thread_id, THREAD);
    assert_eq!(deleted.provider_id, "");
    assert_eq!(fake.trace().last(), Some(&"commit"));
}

impl EmptyThreadQueries for Fake {
    async fn thread_has_messages(&mut self, thread: Uuid) -> anyhow::Result<bool> {
        assert_eq!(thread, THREAD);
        self.step("thread_has_messages")?;
        Ok(!self.empty)
    }
    async fn delete_empty_thread(&mut self, thread: Uuid) -> anyhow::Result<u64> {
        assert_eq!(thread, THREAD);
        self.step("delete_thread")?;
        Ok(1)
    }
}

struct ThreadFacts {
    present: bool,
    affected: u64,
    calls: Vec<&'static str>,
    fail: Option<&'static str>,
}
impl EmptyThreadQueries for ThreadFacts {
    async fn thread_has_messages(&mut self, thread: Uuid) -> anyhow::Result<bool> {
        assert_eq!(thread, THREAD);
        self.calls.push("read");
        anyhow::ensure!(self.fail != Some("read"), "read failed");
        Ok(self.present)
    }
    async fn delete_empty_thread(&mut self, thread: Uuid) -> anyhow::Result<u64> {
        assert_eq!(thread, THREAD);
        self.calls.push("delete");
        anyhow::ensure!(self.fail != Some("delete"), "delete failed");
        Ok(self.affected)
    }
}
#[tokio::test]
async fn empty_thread_counts_preserve_warning_and_short_circuit_nonempty_threads() {
    let telemetry = crate::telemetry_capture::Telemetry::default();
    let _guard = telemetry.install();
    for (present, affected, result) in [
        (true, 0, false),
        (false, 0, false),
        (false, 1, true),
        (false, 2, true),
    ] {
        let mut facts = ThreadFacts {
            present,
            affected,
            calls: vec![],
            fail: None,
        };
        assert_eq!(
            delete_thread_if_empty(&mut facts, THREAD).await.unwrap(),
            result
        );
        assert_eq!(
            facts.calls,
            if present {
                vec!["read"]
            } else {
                vec!["read", "delete"]
            }
        );
    }
    let warnings = telemetry.events("Thread not found for deletion");
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].0, tracing::Level::WARN);
    assert_eq!(warnings[0].1["thread_id"], THREAD.to_string());
    assert_eq!(telemetry.spans("delete_thread_if_empty").len(), 4);
}
#[tokio::test]
async fn empty_thread_query_errors_propagate_before_any_later_statement() {
    for fail in ["read", "delete"] {
        let mut facts = ThreadFacts {
            present: false,
            affected: 1,
            calls: vec![],
            fail: Some(fail),
        };
        assert_eq!(
            delete_thread_if_empty(&mut facts, THREAD)
                .await
                .unwrap_err()
                .to_string(),
            format!("{fail} failed")
        );
        assert_eq!(facts.calls.last(), Some(&fail));
    }
    let mut fake = Fake::ready();
    fake.empty = true;
    fake.fail = Some("delete_thread");
    assert_eq!(
        reconcile_deferred_deletion(&fake, LINK, MESSAGE)
            .await
            .err()
            .unwrap()
            .to_string(),
        "delete_thread failed"
    );
    assert_eq!(fake.trace().last(), Some(&"drop"));
}
