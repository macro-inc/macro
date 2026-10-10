use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use chrono::{DateTime, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde_json::Value;
use uuid::Uuid;

use super::*;
use crate::domain::focus::models::{
    FocusCategory, FocusInbox, FocusMail, FocusMessage, FocusThread,
};

#[derive(Clone, Default)]
struct FakeStore {
    threads: Arc<Mutex<HashMap<Uuid, FocusThread>>>,
    saved: Arc<Mutex<Vec<FocusRecord>>>,
    /// Refuse every save, as when a later message's result is already stored.
    refuse_saves: bool,
    stale: Arc<Mutex<Vec<StaleThread>>>,
    stale_domains: Arc<Mutex<Vec<String>>>,
    mail_reads: Arc<Mutex<usize>>,
}

impl FocusStore for FakeStore {
    async fn thread_inbox(&self, thread_id: Uuid) -> Result<Option<FocusInbox>, Report> {
        Ok(self
            .threads
            .lock()
            .unwrap()
            .get(&thread_id)
            .map(|thread| FocusInbox {
                thread_id: thread.thread_id,
                link_id: thread.link_id,
                owner: thread.owner.clone(),
                owner_email: thread.owner_email.clone(),
                is_signal: thread.is_signal,
                inbox_visible: thread.inbox_visible,
                classified_message_id: thread.classified_message_id,
            }))
    }

    async fn thread_mail(&self, inbox: &FocusInbox) -> Result<FocusMail, Report> {
        *self.mail_reads.lock().unwrap() += 1;
        let threads = self.threads.lock().unwrap();
        let thread = threads.get(&inbox.thread_id).expect("inbox read first");
        Ok(FocusMail {
            messages: thread.messages.clone(),
            sent_notes: thread.sent_notes.clone(),
        })
    }

    async fn save(&self, record: &FocusRecord) -> Result<bool, Report> {
        if self.refuse_saves {
            return Ok(false);
        }
        self.saved.lock().unwrap().push(record.clone());
        Ok(true)
    }

    async fn stale_threads(
        &self,
        _since: DateTime<Utc>,
        domains: &[String],
        _limit: i64,
    ) -> Result<Vec<StaleThread>, Report> {
        *self.stale_domains.lock().unwrap() = domains.to_vec();
        Ok(self.stale.lock().unwrap().clone())
    }

    async fn focus_thread_ids(
        &self,
        _owner: &MacroUserIdStr<'static>,
        _since: DateTime<Utc>,
        _limit: i64,
    ) -> Result<Vec<Uuid>, Report> {
        Ok(Vec::new())
    }

    async fn focus_for_threads(
        &self,
        _owner: &MacroUserIdStr<'static>,
        _thread_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, ThreadFocus>, Report> {
        Ok(HashMap::new())
    }
}

struct FakeProfiles(Option<String>);

impl ProfileSource for FakeProfiles {
    async fn profile(&self, _owner: &MacroUserIdStr<'static>) -> Result<Option<String>, Report> {
        Ok(self.0.clone())
    }
}

#[derive(Clone)]
struct FakeClassifier {
    answers: Result<Vec<f32>, FocusClassifierError>,
    inputs: Arc<Mutex<Vec<Value>>>,
}

impl FakeClassifier {
    fn answering(answers: Result<Vec<f32>, FocusClassifierError>) -> Self {
        Self {
            answers,
            inputs: Arc::default(),
        }
    }
}

impl FocusClassifier for FakeClassifier {
    async fn answer(
        &self,
        _owner: &MacroUserIdStr<'static>,
        _thread_id: Uuid,
        input: &Value,
        questions: &[&'static str],
    ) -> Result<Vec<f32>, FocusClassifierError> {
        assert_eq!(questions.len(), FOCUS_QUESTIONS.len());
        self.inputs.lock().unwrap().push(input.clone());
        self.answers.clone()
    }

    fn model(&self) -> &'static str {
        "jev-test"
    }
}

/// Focus yes, reply needed, everything else no.
fn relevant() -> Vec<f32> {
    vec![0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.8, 0.0, 0.0, 0.9, 0.0]
}

fn thread(owner_email: &str) -> FocusThread {
    FocusThread {
        thread_id: Uuid::new_v4(),
        link_id: Uuid::new_v4(),
        owner: MacroUserIdStr::try_from_email(owner_email).unwrap(),
        owner_email: owner_email.to_owned(),
        is_signal: true,
        inbox_visible: true,
        classified_message_id: None,
        messages: vec![FocusMessage {
            id: Uuid::new_v4(),
            at: Utc.with_ymd_and_hms(2026, 10, 8, 12, 0, 0).unwrap(),
            is_sent: false,
            from_email: Some("ceo@customer.com".to_owned()),
            from_name: Some("Casey".to_owned()),
            to: vec![owner_email.to_owned()],
            cc: Vec::new(),
            subject: Some("Unpaid invoice".to_owned()),
            has_attachments: false,
            bulk: false,
            body: Some("Can you approve the invoice today?".to_owned()),
            snippet: None,
        }],
        sent_notes: Vec::new(),
    }
}

fn service(
    store: &FakeStore,
    classifier: &FakeClassifier,
    domains: &[&str],
) -> FocusService<FakeStore, FakeProfiles, FakeClassifier> {
    FocusService::new(
        store.clone(),
        FakeProfiles(Some("Owner runs finance at Acme.".to_owned())),
        classifier.clone(),
        domains.iter().map(|domain| (*domain).to_owned()).collect(),
    )
}

fn insert(store: &FakeStore, thread: FocusThread) -> Uuid {
    let id = thread.thread_id;
    store.threads.lock().unwrap().insert(id, thread);
    id
}

/// Mark `thread_ids` stale, all last active at `latest_at`.
fn set_stale(store: &FakeStore, thread_ids: &[Uuid], latest_at: DateTime<Utc>) {
    *store.stale.lock().unwrap() = thread_ids
        .iter()
        .map(|&thread_id| StaleThread {
            thread_id,
            latest_at,
        })
        .collect();
}

fn noon() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 8, 12, 0, 0).unwrap()
}

#[tokio::test]
async fn classifies_and_stores_an_enabled_inbox() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let id = insert(&store, thread("owner@acme.com"));
    let outcome = service(&store, &classifier, &[" ACME.com "])
        .classify_thread(id)
        .await
        .unwrap();

    let ClassifyOutcome::Classified(verdict) = outcome else {
        panic!("expected a classification, got {outcome:?}");
    };
    assert!(verdict.is_focus);
    assert!(verdict.needs_reply);
    assert_eq!(verdict.category, FocusCategory::Other);
    let saved = store.saved.lock().unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].thread_id, id);
    assert_eq!(saved[0].model, "jev-test");
    let inputs = classifier.inputs.lock().unwrap();
    assert!(
        inputs[0]["recipient"]
            .as_str()
            .unwrap()
            .contains("Owner runs finance at Acme.")
    );
}

#[tokio::test]
async fn never_sends_mail_from_inboxes_off_the_allowlist() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let id = insert(&store, thread("owner@elsewhere.com"));
    for domains in [&[][..], &["acme.com"][..]] {
        let outcome = service(&store, &classifier, domains)
            .classify_thread(id)
            .await
            .unwrap();
        assert_eq!(outcome, ClassifyOutcome::NotEnabled);
    }
    assert!(classifier.inputs.lock().unwrap().is_empty());
    assert!(store.saved.lock().unwrap().is_empty());
    // No message content is even read for an inbox off the allowlist.
    assert_eq!(*store.mail_reads.lock().unwrap(), 0);
}

#[tokio::test]
async fn skips_threads_outside_the_signal_inbox_and_up_to_date_ones() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let mut archived = thread("owner@acme.com");
    archived.inbox_visible = false;
    let archived = insert(&store, archived);
    let mut current = thread("owner@acme.com");
    current.classified_message_id = Some(current.messages[0].id);
    let current = insert(&store, current);
    let mut only_sent = thread("owner@acme.com");
    only_sent.messages[0].is_sent = true;
    let only_sent = insert(&store, only_sent);

    let service = service(&store, &classifier, &["acme.com"]);
    assert_eq!(
        service.classify_thread(archived).await.unwrap(),
        ClassifyOutcome::NotSignal
    );
    assert_eq!(
        service.classify_thread(current).await.unwrap(),
        ClassifyOutcome::UpToDate
    );
    assert_eq!(
        service.classify_thread(only_sent).await.unwrap(),
        ClassifyOutcome::Missing
    );
    assert_eq!(
        service.classify_thread(Uuid::new_v4()).await.unwrap(),
        ClassifyOutcome::Missing
    );
    assert!(classifier.inputs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn classifier_failures_store_nothing() {
    for (answers, expected) in [
        (
            Err(FocusClassifierError::Unavailable),
            ClassifyOutcome::Unavailable,
        ),
        (
            Err(FocusClassifierError::Rejected),
            ClassifyOutcome::Rejected,
        ),
        (Ok(vec![0.5; 3]), ClassifyOutcome::Rejected),
    ] {
        let store = FakeStore::default();
        let classifier = FakeClassifier::answering(answers);
        let id = insert(&store, thread("owner@acme.com"));
        let outcome = service(&store, &classifier, &["acme.com"])
            .classify_thread(id)
            .await
            .unwrap();
        assert_eq!(outcome, expected);
        assert!(store.saved.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn sweep_stops_when_the_classifier_is_down() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Unavailable));
    let first = insert(&store, thread("owner@acme.com"));
    let second = insert(&store, thread("owner@acme.com"));
    set_stale(&store, &[first, second], noon());

    let report = service(&store, &classifier, &["acme.com"])
        .sweep(Duration::days(30), 100)
        .await
        .unwrap();
    assert_eq!(report.candidates, 2);
    assert_eq!(report.failed, 1);
    assert!(report.stopped_early);
    assert_eq!(classifier.inputs.lock().unwrap().len(), 1);
    assert_eq!(*store.stale_domains.lock().unwrap(), vec!["acme.com"]);
}

#[tokio::test]
async fn sweep_classifies_every_stale_thread() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let first = insert(&store, thread("owner@acme.com"));
    let second = insert(&store, thread("owner@acme.com"));
    set_stale(&store, &[first, second, Uuid::new_v4()], noon());

    let report = service(&store, &classifier, &["acme.com"])
        .sweep(Duration::days(30), 100)
        .await
        .unwrap();
    assert_eq!(
        report,
        SweepReport {
            candidates: 3,
            classified: 2,
            skipped: 1,
            failed: 0,
            stopped_early: false,
        }
    );
}

#[tokio::test]
async fn sweep_does_nothing_without_an_allowlist() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    set_stale(&store, &[insert(&store, thread("owner@acme.com"))], noon());
    let report = service(&store, &classifier, &[])
        .sweep(Duration::days(30), 100)
        .await
        .unwrap();
    assert_eq!(report, SweepReport::default());
    assert!(classifier.inputs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn reports_up_to_date_when_a_later_result_is_already_stored() {
    let store = FakeStore {
        refuse_saves: true,
        ..FakeStore::default()
    };
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let id = insert(&store, thread("owner@acme.com"));
    let outcome = service(&store, &classifier, &["acme.com"])
        .classify_thread(id)
        .await
        .unwrap();
    assert_eq!(outcome, ClassifyOutcome::UpToDate);
}

#[tokio::test]
async fn sweep_leaves_rejected_and_settled_threads_until_new_mail() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Rejected));
    let rejected = insert(&store, thread("owner@acme.com"));
    let mut only_sent = thread("owner@acme.com");
    only_sent.messages[0].is_sent = true;
    let only_sent = insert(&store, only_sent);
    let service = service(&store, &classifier, &["acme.com"]);

    set_stale(&store, &[rejected, only_sent], noon());
    let first = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!((first.failed, first.skipped), (1, 1));
    assert_eq!(*store.mail_reads.lock().unwrap(), 2);

    // Same mail: neither thread is read or sent again.
    let second = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!((second.failed, second.skipped), (0, 2));
    assert_eq!(*store.mail_reads.lock().unwrap(), 2);
    assert_eq!(classifier.inputs.lock().unwrap().len(), 1);

    // New mail on the rejected thread: it is tried again.
    set_stale(&store, &[rejected], noon() + Duration::minutes(5));
    let third = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!(third.failed, 1);
    assert_eq!(classifier.inputs.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn sweep_stops_when_the_classifier_rejects_everything() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Rejected));
    let threads = (0..MAX_REJECTIONS_IN_A_ROW + 3)
        .map(|_| insert(&store, thread("owner@acme.com")))
        .collect::<Vec<_>>();
    set_stale(&store, &threads, noon());

    let report = service(&store, &classifier, &["acme.com"])
        .sweep(Duration::days(30), 100)
        .await
        .unwrap();
    assert!(report.stopped_early);
    assert_eq!(report.failed, MAX_REJECTIONS_IN_A_ROW);
    assert_eq!(
        classifier.inputs.lock().unwrap().len(),
        MAX_REJECTIONS_IN_A_ROW
    );
}
