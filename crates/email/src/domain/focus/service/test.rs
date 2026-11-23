use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde_json::Value;
use uuid::Uuid;

use super::*;
use crate::domain::focus::models::{
    CalendarPart, DueDateInput, FocusCategory, FocusInbox, FocusInboxOwner, FocusMail,
    FocusMessage, FocusThread, SentNote, StoredClassification, ThreadDates,
};

/// The owner of most test threads, and the one inbox they live in.
const OWNER: &str = "owner@acme.example";
const INBOX: Uuid = Uuid::from_u128(0xf0c5);

#[derive(Clone, Default)]
struct FakeStore {
    threads: Arc<Mutex<HashMap<Uuid, FocusThread>>>,
    saved: Arc<Mutex<Vec<FocusRecord>>>,
    /// Refuse every save, as when a later message's result is already stored.
    refuse_saves: bool,
    /// Stale threads and the inbox each is in, newest first.
    stale: Arc<Mutex<Vec<(Uuid, StaleThread)>>>,
    /// Inboxes holding Focus.
    focus_inboxes: Arc<Mutex<Vec<FocusInboxOwner>>>,
    /// Every connected inbox.
    syncing: Arc<Mutex<Vec<FocusInboxOwner>>>,
    /// The users other than its owner each inbox is linked to.
    delegates: Arc<Mutex<HashMap<Uuid, Vec<MacroUserIdStr<'static>>>>>,
    /// Inboxes whose stale-thread reads fail, as one that times out does.
    failing_reads: Arc<Mutex<HashSet<Uuid>>>,
    /// The inbox each stale-thread read was given.
    stale_reads: Arc<Mutex<Vec<Uuid>>>,
    mail_reads: Arc<Mutex<usize>>,
    /// The cutoff each list read was given.
    waiting_before: Arc<Mutex<Vec<DateTime<Utc>>>>,
    read_at: Arc<Mutex<Vec<DateTime<Utc>>>>,
}

impl FakeStore {
    fn delegates_of(&self, link_id: Uuid) -> Vec<MacroUserIdStr<'static>> {
        self.delegates
            .lock()
            .unwrap()
            .get(&link_id)
            .cloned()
            .unwrap_or_default()
    }

    /// `inbox` with the users it is linked to now, as the database reads them.
    fn linked(&self, inbox: &FocusInboxOwner) -> FocusInboxOwner {
        FocusInboxOwner {
            delegates: self.delegates_of(inbox.link_id),
            ..inbox.clone()
        }
    }
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
                delegates: self.delegates_of(thread.link_id),
                owner_email: thread.owner_email.clone(),
                is_signal: thread.is_signal,
                inbox_visible: thread.inbox_visible,
                classified: thread.classified.clone(),
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
        link_id: Uuid,
        _since: DateTime<Utc>,
        after: Option<StaleThread>,
        limit: i64,
    ) -> Result<Vec<StaleThread>, Report> {
        self.stale_reads.lock().unwrap().push(link_id);
        if self.failing_reads.lock().unwrap().contains(&link_id) {
            return Err(rootcause::report!(
                "canceling statement due to statement timeout"
            ));
        }
        let stale = self
            .stale
            .lock()
            .unwrap()
            .iter()
            .filter(|(link, _)| *link == link_id)
            .map(|(_, thread)| *thread)
            .collect::<Vec<_>>();
        let start = after.map_or(0, |after| {
            stale
                .iter()
                .position(|thread| *thread == after)
                .map_or(stale.len(), |index| index + 1)
        });
        Ok(stale
            .into_iter()
            .skip(start)
            .take(usize::try_from(limit).unwrap())
            .collect())
    }

    async fn inboxes_with_focus(&self) -> Result<Vec<FocusInboxOwner>, Report> {
        let inboxes = self.focus_inboxes.lock().unwrap().clone();
        Ok(inboxes.iter().map(|inbox| self.linked(inbox)).collect())
    }

    async fn syncing_inboxes(&self) -> Result<Vec<FocusInboxOwner>, Report> {
        let inboxes = self.syncing.lock().unwrap().clone();
        Ok(inboxes.iter().map(|inbox| self.linked(inbox)).collect())
    }

    async fn focus_thread_ids(
        &self,
        _owner: &MacroUserIdStr<'static>,
        _since: DateTime<Utc>,
        waiting_before: DateTime<Utc>,
        now: DateTime<Utc>,
        _limit: i64,
    ) -> Result<Vec<Uuid>, Report> {
        self.waiting_before.lock().unwrap().push(waiting_before);
        self.read_at.lock().unwrap().push(now);
        Ok(Vec::new())
    }

    async fn focus_for_threads(
        &self,
        _owner: &MacroUserIdStr<'static>,
        _thread_ids: &[Uuid],
        waiting_before: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<HashMap<Uuid, ThreadFocus>, Report> {
        self.waiting_before.lock().unwrap().push(waiting_before);
        self.read_at.lock().unwrap().push(now);
        Ok(HashMap::new())
    }
}

struct FakeProfiles(Option<String>, Option<String>);

impl ProfileSource for FakeProfiles {
    async fn profile(&self, _owner: &MacroUserIdStr<'static>) -> Result<Option<String>, Report> {
        Ok(self.0.clone())
    }

    async fn time_zone(&self, _owner: &MacroUserIdStr<'static>) -> Result<Option<String>, Report> {
        Ok(self.1.clone())
    }
}

/// What the due date extractor does with a request.
#[derive(Clone, Copy)]
enum DueDateAnswer {
    Finds(ThreadDates),
    Fails,
    Hangs,
}

#[derive(Clone)]
struct FakeDueDates {
    answer: DueDateAnswer,
    inputs: Arc<Mutex<Vec<DueDateInput>>>,
}

impl FakeDueDates {
    fn answering(answer: DueDateAnswer) -> Self {
        Self {
            answer,
            inputs: Arc::default(),
        }
    }
}

impl DueDateExtractor for FakeDueDates {
    async fn dates(
        &self,
        _owner: &MacroUserIdStr<'static>,
        _thread_id: Uuid,
        input: &DueDateInput,
    ) -> Result<ThreadDates, Report> {
        self.inputs.lock().unwrap().push(input.clone());
        match self.answer {
            DueDateAnswer::Finds(dates) => Ok(dates),
            DueDateAnswer::Fails => Err(rootcause::report!("the model is down")),
            DueDateAnswer::Hangs => std::future::pending().await,
        }
    }
}

#[derive(Clone, Default)]
struct FakeNotifier {
    changed: Arc<Mutex<Vec<(MacroUserIdStr<'static>, Uuid)>>>,
}

impl FocusNotifier for FakeNotifier {
    fn focus_changed(&self, owner: &MacroUserIdStr<'static>, link_id: Uuid) {
        self.changed.lock().unwrap().push((owner.clone(), link_id));
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

/// Who is in the rollout.
#[derive(Clone, Default)]
struct FakeEnrollment {
    enrolled: Arc<Mutex<HashSet<MacroUserIdStr<'static>>>>,
    /// Fail every check, as when the flag service is down.
    down: bool,
    /// Users whose checks fail while others' are read.
    unreadable: Arc<Mutex<HashSet<MacroUserIdStr<'static>>>>,
    /// Each user checked, in order.
    checks: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
}

impl FakeEnrollment {
    fn enrolling(emails: &[&str]) -> Self {
        let enrollment = Self::default();
        for email in emails {
            enrollment.enroll(email);
        }
        enrollment
    }

    fn enroll(&self, email: &str) {
        self.enrolled.lock().unwrap().insert(owner(email));
    }

    fn leave(&self, email: &str) {
        self.enrolled.lock().unwrap().remove(&owner(email));
    }
}

impl FocusEnrollment for FakeEnrollment {
    async fn is_enrolled(&self, owner: &MacroUserIdStr<'static>) -> Result<bool, Report> {
        self.checks.lock().unwrap().push(owner.clone());
        if self.down || self.unreadable.lock().unwrap().contains(owner) {
            return Err(rootcause::report!("the flag service is down"));
        }
        Ok(self.enrolled.lock().unwrap().contains(owner))
    }
}

/// The owner of the test inbox is in the rollout.
fn enrolled() -> FakeEnrollment {
    FakeEnrollment::enrolling(&[OWNER])
}

fn owner(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

/// Focus yes, reply needed, everything else no.
fn relevant() -> Vec<f32> {
    vec![0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9, 0.0, 0.0, 0.0]
}

fn thread(owner_email: &str) -> FocusThread {
    FocusThread {
        thread_id: Uuid::new_v4(),
        link_id: INBOX,
        owner: owner(owner_email),
        owner_email: owner_email.to_owned(),
        is_signal: true,
        inbox_visible: true,
        classified: None,
        messages: vec![FocusMessage {
            id: Uuid::new_v4(),
            at: Utc.with_ymd_and_hms(2026, 10, 8, 12, 0, 0).unwrap(),
            is_sent: false,
            from_email: Some("ceo@customer.example".to_owned()),
            from_name: Some("Casey".to_owned()),
            to: vec![owner_email.to_owned()],
            cc: Vec::new(),
            subject: Some("Unpaid invoice".to_owned()),
            has_attachments: false,
            bulk: false,
            calendar_part: None,
            body: Some("Can you approve the invoice today?".to_owned()),
            snippet: None,
            date_header: None,
        }],
        sent_notes: Vec::new(),
    }
}

type TestService = FocusService<
    FakeStore,
    FakeProfiles,
    FakeClassifier,
    FakeNotifier,
    FakeDueDates,
    FakeEnrollment,
>;

fn service(
    store: &FakeStore,
    classifier: &FakeClassifier,
    enrollment: &FakeEnrollment,
) -> TestService {
    notifying_service(store, classifier, enrollment, &FakeNotifier::default())
}

fn notifying_service(
    store: &FakeStore,
    classifier: &FakeClassifier,
    enrollment: &FakeEnrollment,
    notifier: &FakeNotifier,
) -> TestService {
    FocusService::new(
        store.clone(),
        FakeProfiles(Some("Owner runs finance at Acme.".to_owned()), None),
        classifier.clone(),
        notifier.clone(),
        FakeDueDates::answering(DueDateAnswer::Finds(ThreadDates::default())),
        enrollment.clone(),
    )
}

fn due_date_service(
    store: &FakeStore,
    classifier: &FakeClassifier,
    due_dates: &FakeDueDates,
    time_zone: Option<&str>,
) -> TestService {
    FocusService::new(
        store.clone(),
        FakeProfiles(None, time_zone.map(str::to_owned)),
        classifier.clone(),
        FakeNotifier::default(),
        due_dates.clone(),
        enrolled(),
    )
}

fn friday() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 9).unwrap()
}

/// What mail says when it names only a deadline, on `day`.
fn due(day: NaiveDate) -> ThreadDates {
    ThreadDates {
        due_on: Some(day),
        event_on: None,
    }
}

/// Days stored with an earlier classification: due Friday, about a meeting on
/// the Monday after, in New York.
fn stored_dates() -> FocusDates {
    FocusDates {
        due_on: Some(friday()),
        due_at: Some(Utc.with_ymd_and_hms(2026, 10, 9, 4, 0, 0).unwrap()),
        event_over_at: Some(Utc.with_ymd_and_hms(2026, 10, 13, 4, 0, 0).unwrap()),
    }
}

fn insert(store: &FakeStore, thread: FocusThread) -> Uuid {
    let id = thread.thread_id;
    store.threads.lock().unwrap().insert(id, thread);
    id
}

/// Mark `thread_ids` stale, all last active at `latest_at`, each in its
/// thread's inbox (the test inbox for a thread that doesn't exist), and list
/// those inboxes as holding Focus, so the sweep covers them.
fn set_stale(store: &FakeStore, thread_ids: &[Uuid], latest_at: DateTime<Utc>) {
    let threads = store.threads.lock().unwrap();
    let mut focus_inboxes = store.focus_inboxes.lock().unwrap();
    *store.stale.lock().unwrap() = thread_ids
        .iter()
        .map(|&thread_id| {
            let (link_id, owner_id) = threads
                .get(&thread_id)
                .map_or((INBOX, owner(OWNER)), |thread| {
                    (thread.link_id, thread.owner.clone())
                });
            if !focus_inboxes.iter().any(|inbox| inbox.link_id == link_id) {
                focus_inboxes.push(FocusInboxOwner {
                    link_id,
                    owner: owner_id,
                    delegates: Vec::new(),
                });
            }
            (
                link_id,
                StaleThread {
                    thread_id,
                    latest_at,
                },
            )
        })
        .collect();
}

fn noon() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 8, 12, 0, 0).unwrap()
}

/// A classification of `thread`'s latest message: Focus low, reply needed.
fn stored_at(thread: &FocusThread, rule_version: i16) -> StoredClassification {
    let answers =
        FocusAnswers::from_probabilities(&[0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9, 0.0, 0.0, 0.0]);
    StoredClassification {
        message_id: thread.messages.last().unwrap().id,
        rule_version,
        answers,
        model: "jev-earlier".to_owned(),
        dates: FocusDates::default(),
    }
}

#[tokio::test]
async fn classifies_and_stores_an_enabled_inbox() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let id = insert(&store, thread(OWNER));
    let outcome = service(&store, &classifier, &enrolled())
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
async fn never_reads_mail_of_an_owner_outside_the_rollout() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let id = insert(&store, thread("owner@elsewhere.example"));
    for enrollment in [FakeEnrollment::default(), enrolled()] {
        let outcome = service(&store, &classifier, &enrollment)
            .classify_thread(id)
            .await
            .unwrap();
        assert_eq!(outcome, ClassifyOutcome::NotEnabled);
        assert_eq!(
            *enrollment.checks.lock().unwrap(),
            vec![owner("owner@elsewhere.example")]
        );
    }
    assert!(classifier.inputs.lock().unwrap().is_empty());
    assert!(store.saved.lock().unwrap().is_empty());
    // No message content is even read for an owner outside the rollout.
    assert_eq!(*store.mail_reads.lock().unwrap(), 0);
}

#[tokio::test]
async fn an_unknown_rollout_reads_no_mail_and_fails_the_thread() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let id = insert(&store, thread(OWNER));
    let down = FakeEnrollment {
        down: true,
        ..enrolled()
    };
    assert!(
        service(&store, &classifier, &down)
            .classify_thread(id)
            .await
            .is_err()
    );
    assert_eq!(*store.mail_reads.lock().unwrap(), 0);
    assert!(classifier.inputs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_rollout_is_checked_only_for_threads_in_the_inbox() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let mut archived = thread(OWNER);
    archived.inbox_visible = false;
    let archived = insert(&store, archived);
    let enrollment = enrolled();
    let outcome = service(&store, &classifier, &enrollment)
        .classify_thread(archived)
        .await
        .unwrap();
    assert_eq!(outcome, ClassifyOutcome::NotSignal);
    assert!(enrollment.checks.lock().unwrap().is_empty());
}

#[tokio::test]
async fn skips_threads_outside_the_signal_inbox_and_up_to_date_ones() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let mut archived = thread(OWNER);
    archived.inbox_visible = false;
    let archived = insert(&store, archived);
    let mut current = thread(OWNER);
    current.classified = Some(stored_at(&current, FOCUS_RULE_VERSION));
    let current = insert(&store, current);
    let mut only_sent = thread(OWNER);
    only_sent.messages[0].is_sent = true;
    let only_sent = insert(&store, only_sent);

    let service = service(&store, &classifier, &enrolled());
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
        let id = insert(&store, thread(OWNER));
        let outcome = service(&store, &classifier, &enrolled())
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
    let first = insert(&store, thread(OWNER));
    let second = insert(&store, thread(OWNER));
    set_stale(&store, &[first, second], noon());

    let report = service(&store, &classifier, &enrolled())
        .sweep(Duration::days(30), 100)
        .await
        .unwrap();
    assert_eq!(report.candidates, 2);
    assert_eq!(report.failed, 1);
    assert!(report.stopped_early);
    assert_eq!(classifier.inputs.lock().unwrap().len(), 1);
    assert_eq!(*store.stale_reads.lock().unwrap(), vec![INBOX]);
}

#[tokio::test]
async fn sweep_classifies_every_stale_thread() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let first = insert(&store, thread(OWNER));
    let second = insert(&store, thread(OWNER));
    set_stale(&store, &[first, second, Uuid::new_v4()], noon());

    let report = service(&store, &classifier, &enrolled())
        .sweep(Duration::days(30), 100)
        .await
        .unwrap();
    assert_eq!(
        report,
        SweepReport {
            inboxes: 1,
            inboxes_unknown: 0,
            inboxes_left: 0,
            inboxes_failed: 0,
            candidates: 3,
            classified: 2,
            redecided: 0,
            skipped: 1,
            failed: 0,
            stopped_early: false,
        }
    );
}

#[tokio::test]
async fn sweep_does_nothing_outside_the_rollout() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    set_stale(&store, &[insert(&store, thread(OWNER))], noon());
    let report = service(&store, &classifier, &FakeEnrollment::default())
        .sweep(Duration::days(30), 100)
        .await
        .unwrap();
    assert_eq!(report, SweepReport::default());
    assert!(store.stale_reads.lock().unwrap().is_empty());
    assert!(classifier.inputs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn sweep_covers_only_inboxes_whose_owner_is_in_the_rollout() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let ours = insert(&store, thread(OWNER));
    let mut theirs = thread("other@acme.example");
    theirs.link_id = Uuid::new_v4();
    let their_inbox = theirs.link_id;
    let theirs = insert(&store, theirs);
    set_stale(&store, &[ours, theirs], noon());
    assert_eq!(store.focus_inboxes.lock().unwrap().len(), 2);

    let report = service(&store, &classifier, &enrolled())
        .sweep(Duration::days(30), 100)
        .await
        .unwrap();
    assert_eq!((report.inboxes, report.classified), (1, 1));
    assert_eq!(*store.stale_reads.lock().unwrap(), vec![INBOX]);
    assert_eq!(store.saved.lock().unwrap()[0].thread_id, ours);
    assert!(!store.stale_reads.lock().unwrap().contains(&their_inbox));
}

#[tokio::test]
async fn sweep_goes_on_past_an_inbox_whose_threads_cannot_be_read() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let mut slow = thread("other@acme.example");
    slow.link_id = Uuid::new_v4();
    let slow_inbox = slow.link_id;
    let slow = insert(&store, slow);
    let ours = insert(&store, thread(OWNER));
    set_stale(&store, &[slow, ours], noon());
    store.failing_reads.lock().unwrap().insert(slow_inbox);
    let enrollment = FakeEnrollment::enrolling(&[OWNER, "other@acme.example"]);

    let report = service(&store, &classifier, &enrollment)
        .sweep(Duration::days(30), 100)
        .await
        .unwrap();
    assert_eq!(
        (report.inboxes, report.inboxes_failed, report.classified),
        (2, 1, 1)
    );
    assert_eq!(store.saved.lock().unwrap()[0].thread_id, ours);
    let reads = store.stale_reads.lock().unwrap().clone();
    assert!(reads.contains(&slow_inbox) && reads.contains(&INBOX));
}

#[tokio::test]
async fn sweep_covers_an_inbox_seen_in_the_rollout_before_it_holds_focus() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Rejected));
    let enrollment = enrolled();
    let service = service(&store, &classifier, &enrollment);
    let first = insert(&store, thread(OWNER));
    let older = insert(&store, thread(OWNER));
    // Mail arrives: the inbox joins the sweep though nothing in it is Focus yet.
    service.classify_thread(first).await.unwrap();
    store.stale.lock().unwrap().push((
        INBOX,
        StaleThread {
            thread_id: older,
            latest_at: noon(),
        },
    ));
    assert!(store.focus_inboxes.lock().unwrap().is_empty());

    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!((report.inboxes, report.failed), (1, 1));

    // The owner leaves the rollout: the next sweep drops the inbox.
    enrollment.leave(OWNER);
    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!(report.inboxes, 0);
    enrollment.enroll(OWNER);
    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!(report, SweepReport::default());
}

#[tokio::test]
async fn sweep_leaves_out_an_inbox_whose_rollout_is_unknown() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let mut noise = thread(OWNER);
    noise.is_signal = false;
    let noise = insert(&store, noise);
    set_stale(&store, &[noise], noon());
    let enrollment = enrolled();
    let service = service(&store, &classifier, &enrollment);
    service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!(service.settled().len(), 1);

    let down = FakeEnrollment {
        down: true,
        ..enrolled()
    };
    let service = FocusService {
        enrollment: down,
        ..service
    };
    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!((report.inboxes, report.inboxes_unknown), (0, 1));
    // It saw no inbox in full, so it forgets none of what it settled.
    assert_eq!(service.settled().len(), 1);
}

#[tokio::test]
async fn reports_up_to_date_when_a_later_result_is_already_stored() {
    let store = FakeStore {
        refuse_saves: true,
        ..FakeStore::default()
    };
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let id = insert(&store, thread(OWNER));
    let outcome = service(&store, &classifier, &enrolled())
        .classify_thread(id)
        .await
        .unwrap();
    assert_eq!(outcome, ClassifyOutcome::UpToDate);
}

#[tokio::test]
async fn sweep_leaves_rejected_and_settled_threads_until_new_mail() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Rejected));
    let rejected = insert(&store, thread(OWNER));
    let mut only_sent = thread(OWNER);
    only_sent.messages[0].is_sent = true;
    let only_sent = insert(&store, only_sent);
    let service = service(&store, &classifier, &enrolled());

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
async fn sweeps_reach_threads_behind_ones_that_never_store_a_result() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let service = service(&store, &classifier, &enrolled());
    // More non-signal threads than one sweep's limit, newest first, then a thread
    // that is worth classifying.
    let mut stale = (0..5)
        .map(|_| {
            let mut noise = thread(OWNER);
            noise.is_signal = false;
            insert(&store, noise)
        })
        .collect::<Vec<_>>();
    let older = insert(&store, thread(OWNER));
    stale.push(older);
    set_stale(&store, &stale, noon());

    // Two checks a sweep: the third sweep gets there, past the settled ones.
    for _ in 0..2 {
        let report = service.sweep(Duration::days(30), 2).await.unwrap();
        assert_eq!(report.classified, 0);
    }
    let reads_so_far = *store.mail_reads.lock().unwrap();
    assert_eq!(reads_so_far, 4);
    let report = service.sweep(Duration::days(30), 2).await.unwrap();
    assert_eq!(report.classified, 1);
    assert_eq!(*store.mail_reads.lock().unwrap(), reads_so_far + 2);
    assert_eq!(classifier.inputs.lock().unwrap().len(), 1);

    // Everything is settled or stored now, however far back the sweep looks.
    store.stale.lock().unwrap().pop();
    let report = service.sweep(Duration::days(30), 2).await.unwrap();
    assert_eq!(report.skipped, 5);
    assert_eq!(*store.mail_reads.lock().unwrap(), reads_so_far + 2);
}

#[tokio::test]
async fn only_a_full_sweep_forgets_what_it_settled() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Unavailable));
    let service = service(&store, &classifier, &enrolled());
    let mut noise = thread(OWNER);
    noise.is_signal = false;
    let noise = insert(&store, noise);
    let down = insert(&store, thread(OWNER));
    set_stale(&store, &[noise], noon());
    service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!(*store.mail_reads.lock().unwrap(), 1);

    // Cut short before it reached the settled thread: that says nothing about it.
    set_stale(&store, &[down, noise], noon());
    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert!(report.stopped_early);
    assert_eq!(*store.mail_reads.lock().unwrap(), 2);
    set_stale(&store, &[noise], noon());
    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!(report.skipped, 1);
    assert_eq!(*store.mail_reads.lock().unwrap(), 2);

    // A full sweep that no longer finds it forgets it, so the map stays small.
    set_stale(&store, &[], noon());
    service.sweep(Duration::days(30), 100).await.unwrap();
    assert!(service.settled().is_empty());
}

#[tokio::test]
async fn sweep_stops_when_the_classifier_rejects_everything() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Rejected));
    let threads = (0..MAX_REJECTIONS_IN_A_ROW + 3)
        .map(|_| insert(&store, thread(OWNER)))
        .collect::<Vec<_>>();
    set_stale(&store, &threads, noon());

    let report = service(&store, &classifier, &enrolled())
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

#[tokio::test]
async fn a_stored_classification_tells_the_inbox_readers() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let notifier = FakeNotifier::default();
    let thread = thread(OWNER);
    let (owner, link_id) = (thread.owner.clone(), thread.link_id);
    let thread_id = insert(&store, thread);

    notifying_service(&store, &classifier, &enrolled(), &notifier)
        .classify_thread(thread_id)
        .await
        .unwrap();

    assert_eq!(*notifier.changed.lock().unwrap(), vec![(owner, link_id)]);
}

#[tokio::test]
async fn nothing_stored_tells_nobody() {
    let notifier = FakeNotifier::default();

    // A later message's result is already stored.
    let refusing = FakeStore {
        refuse_saves: true,
        ..FakeStore::default()
    };
    let thread_id = insert(&refusing, thread(OWNER));
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let outcome = notifying_service(&refusing, &classifier, &enrolled(), &notifier)
        .classify_thread(thread_id)
        .await
        .unwrap();
    assert_eq!(outcome, ClassifyOutcome::UpToDate);

    // The classifier gave no answers.
    let store = FakeStore::default();
    let thread_id = insert(&store, thread(OWNER));
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Unavailable));
    let outcome = notifying_service(&store, &classifier, &enrolled(), &notifier)
        .classify_thread(thread_id)
        .await
        .unwrap();
    assert_eq!(outcome, ClassifyOutcome::Unavailable);

    assert!(notifier.changed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn deciding_again_under_a_new_rule_tells_the_inbox_readers() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Unavailable));
    let notifier = FakeNotifier::default();
    let mut legacy = thread(OWNER);
    legacy.classified = Some(stored_at(&legacy, 0));
    let (owner, link_id) = (legacy.owner.clone(), legacy.link_id);
    let id = insert(&store, legacy);

    let outcome = notifying_service(&store, &classifier, &enrolled(), &notifier)
        .classify_thread(id)
        .await
        .unwrap();

    assert!(matches!(outcome, ClassifyOutcome::Redecided(_)));
    assert_eq!(*notifier.changed.lock().unwrap(), vec![(owner, link_id)]);
}

#[tokio::test]
async fn key_mail_outside_the_signal_inbox_tells_the_inbox_readers() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let notifier = FakeNotifier::default();
    let service = notifying_service(&store, &classifier, &enrolled(), &notifier);

    let mut noise = thread(OWNER);
    noise.is_signal = false;
    let noise = insert(&store, noise);
    assert_eq!(
        service.classify_thread(noise).await.unwrap(),
        ClassifyOutcome::NotSignal
    );
    assert!(notifier.changed.lock().unwrap().is_empty());

    let mut reschedule = thread(OWNER);
    reschedule.is_signal = false;
    reschedule.messages[0].calendar_part = Some(CalendarPart::Change {
        until: Utc::now() + Duration::days(2),
    });
    let (owner, link_id) = (reschedule.owner.clone(), reschedule.link_id);
    let reschedule = insert(&store, reschedule);
    service.classify_thread(reschedule).await.unwrap();

    assert_eq!(*notifier.changed.lock().unwrap(), vec![(owner, link_id)]);
}

#[tokio::test]
async fn an_older_rule_is_decided_again_without_the_classifier() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Unavailable));
    let mut legacy = thread(OWNER);
    legacy.classified = Some(stored_at(&legacy, 0));
    let id = insert(&store, legacy);

    let outcome = service(&store, &classifier, &enrolled())
        .classify_thread(id)
        .await
        .unwrap();
    let ClassifyOutcome::Redecided(verdict) = outcome else {
        panic!("expected a new decision, got {outcome:?}");
    };
    // The stored answers now read as a reply the owner owes, on a low score.
    assert!(verdict.is_focus && verdict.pinned && verdict.needs_reply);
    assert!(classifier.inputs.lock().unwrap().is_empty());
    let saved = store.saved.lock().unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].model, "jev-earlier");
    assert_eq!(saved[0].answers.needs_response, 0.9);
}

#[tokio::test]
async fn sweep_counts_threads_decided_again_apart_from_classified_ones() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let mut legacy = thread(OWNER);
    legacy.classified = Some(stored_at(&legacy, 0));
    let legacy = insert(&store, legacy);
    let new = insert(&store, thread(OWNER));
    set_stale(&store, &[legacy, new], noon());

    let report = service(&store, &classifier, &enrolled())
        .sweep(Duration::days(30), 100)
        .await
        .unwrap();
    assert_eq!((report.classified, report.redecided), (1, 1));
    assert_eq!(classifier.inputs.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn answers_that_no_longer_decode_go_back_to_the_classifier() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let mut unreadable = thread(OWNER);
    unreadable.classified = Some(StoredClassification {
        answers: None,
        ..stored_at(&unreadable, 0)
    });
    let id = insert(&store, unreadable);

    let outcome = service(&store, &classifier, &enrolled())
        .classify_thread(id)
        .await
        .unwrap();
    assert!(matches!(outcome, ClassifyOutcome::Classified(_)));
    assert_eq!(classifier.inputs.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn new_mail_goes_to_the_classifier_even_under_an_older_rule() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let mut stale = thread(OWNER);
    stale.classified = Some(StoredClassification {
        message_id: Uuid::new_v4(),
        ..stored_at(&stale, 0)
    });
    let id = insert(&store, stale);

    let outcome = service(&store, &classifier, &enrolled())
        .classify_thread(id)
        .await
        .unwrap();
    assert!(matches!(outcome, ClassifyOutcome::Classified(_)));
    assert_eq!(classifier.inputs.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn outside_the_signal_inbox_only_key_mail_reaches_the_classifier() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let service = service(&store, &classifier, &enrolled());

    let mut noise = thread(OWNER);
    noise.is_signal = false;
    let noise = insert(&store, noise);
    assert_eq!(
        service.classify_thread(noise).await.unwrap(),
        ClassifyOutcome::NotSignal
    );
    assert!(classifier.inputs.lock().unwrap().is_empty());

    let mut rsvp = thread(OWNER);
    rsvp.is_signal = false;
    rsvp.messages[0].calendar_part = Some(CalendarPart::Rsvp);
    let rsvp = insert(&store, rsvp);
    assert_eq!(
        service.classify_thread(rsvp).await.unwrap(),
        ClassifyOutcome::NotSignal
    );
    assert!(classifier.inputs.lock().unwrap().is_empty());

    // Neither is a new invite, or a change to an event that is already over.
    let mut new_invite = thread(OWNER);
    new_invite.is_signal = false;
    new_invite.messages[0].calendar_part = Some(CalendarPart::NewInvite {
        until: Utc::now() + Duration::days(2),
    });
    let new_invite = insert(&store, new_invite);
    assert_eq!(
        service.classify_thread(new_invite).await.unwrap(),
        ClassifyOutcome::NotSignal
    );
    let mut over = thread(OWNER);
    over.is_signal = false;
    over.messages[0].calendar_part = Some(CalendarPart::Change {
        until: Utc::now() - Duration::hours(1),
    });
    let over = insert(&store, over);
    assert_eq!(
        service.classify_thread(over).await.unwrap(),
        ClassifyOutcome::NotSignal
    );
    assert!(classifier.inputs.lock().unwrap().is_empty());

    let until = Utc::now() + Duration::days(2);
    let mut reschedule = thread(OWNER);
    reschedule.is_signal = false;
    reschedule.messages[0].calendar_part = Some(CalendarPart::Change { until });
    let reschedule = insert(&store, reschedule);
    let ClassifyOutcome::Classified(verdict) = service.classify_thread(reschedule).await.unwrap()
    else {
        panic!("expected the reschedule to be classified");
    };
    assert_eq!(verdict.calendar_hold_until, Some(until));

    let mut contact = thread(OWNER);
    contact.is_signal = false;
    contact.sent_notes = vec![SentNote {
        recipient: "ceo@customer.example".to_owned(),
        at: noon() - Duration::days(7),
        body: Some("Sending the invoice over now".to_owned()),
    }];
    let contact = insert(&store, contact);
    let ClassifyOutcome::Classified(verdict) = service.classify_thread(contact).await.unwrap()
    else {
        panic!("expected the recent contact to be classified");
    };
    assert!(verdict.is_focus && verdict.pinned);
}

#[tokio::test]
async fn a_thread_the_owner_answered_last_is_classified_outside_the_signal_inbox() {
    let store = FakeStore::default();
    // Reads as automated, so only the wait can bring it in.
    let classifier =
        FakeClassifier::answering(Ok(vec![0.0, 0.0, 0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    let mut waiting = thread(OWNER);
    waiting.is_signal = false;
    let mut reply = waiting.messages[0].clone();
    reply.id = Uuid::new_v4();
    reply.at = noon() + Duration::hours(1);
    reply.is_sent = true;
    reply.from_email = Some("owner@acme.example".to_owned());
    reply.to = vec!["ceo@customer.example".to_owned()];
    reply.body = Some("Can you resend the invoice?".to_owned());
    waiting.messages.push(reply);
    let id = insert(&store, waiting);

    let outcome = service(&store, &classifier, &enrolled())
        .classify_thread(id)
        .await
        .unwrap();
    let ClassifyOutcome::Classified(verdict) = outcome else {
        panic!("expected a classification, got {outcome:?}");
    };
    // The list applies the age; the verdict records that it can.
    assert!(!verdict.is_focus);
    assert!(verdict.awaiting_reply);
}

#[tokio::test]
async fn a_thread_of_only_sent_mail_never_reaches_the_classifier() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let service = service(&store, &classifier, &enrolled());

    // As the projection stores it: never in the inbox, and so not visible.
    let mut unanswered = thread(OWNER);
    unanswered.inbox_visible = false;
    unanswered.messages[0].is_sent = true;
    unanswered.messages[0].from_email = Some("owner@acme.example".to_owned());
    unanswered.messages[0].to = vec!["ceo@customer.example".to_owned()];
    let hidden = insert(&store, unanswered.clone());
    assert_eq!(
        service.classify_thread(hidden).await.unwrap(),
        ClassifyOutcome::NotSignal
    );

    // Back in the inbox through a reminder, it still has no mail from anyone else.
    unanswered.thread_id = Uuid::new_v4();
    unanswered.inbox_visible = true;
    let returned = insert(&store, unanswered);
    assert_eq!(
        service.classify_thread(returned).await.unwrap(),
        ClassifyOutcome::Missing
    );
    assert!(classifier.inputs.lock().unwrap().is_empty());
    assert!(store.saved.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_lists_apply_a_three_day_wait() {
    let store = FakeStore::default();
    let queries = FocusQueries::new(store.clone());
    let owner = MacroUserIdStr::try_from_email("owner@acme.example").unwrap();

    let before = Utc::now() - Duration::days(FOLLOW_UP_AFTER_DAYS);
    queries.focus_thread_ids(&owner, 30).await.unwrap();
    queries
        .focus_for_threads(&owner, &[Uuid::new_v4()])
        .await
        .unwrap();
    let after = Utc::now() - Duration::days(FOLLOW_UP_AFTER_DAYS);

    let cutoffs = store.waiting_before.lock().unwrap();
    assert_eq!(cutoffs.len(), 2);
    assert!(
        cutoffs
            .iter()
            .all(|cutoff| before <= *cutoff && *cutoff <= after)
    );
    assert_eq!(FOLLOW_UP_AFTER_DAYS, 3);
    let read_at = store.read_at.lock().unwrap();
    assert_eq!(read_at.len(), 2);
    assert!(
        read_at
            .iter()
            .all(|now| before + Duration::days(FOLLOW_UP_AFTER_DAYS) <= *now)
    );
}

#[tokio::test]
async fn a_focus_thread_stores_the_day_its_mail_says_it_is_due() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(due(friday())));
    let id = insert(&store, thread(OWNER));

    let outcome = due_date_service(&store, &classifier, &due_dates, None)
        .classify_thread(id)
        .await
        .unwrap();

    assert!(matches!(outcome, ClassifyOutcome::Classified(_)));
    assert_eq!(store.saved.lock().unwrap()[0].dates.due_on, Some(friday()));
    let inputs = due_dates.inputs.lock().unwrap();
    assert_eq!(inputs.len(), 1);
    assert_eq!(
        inputs[0].messages[0].text,
        "Can you approve the invoice today?"
    );
}

#[tokio::test]
async fn the_days_take_effect_when_they_begin_for_the_owner() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    // Due Friday, about a meeting on the Monday after.
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(ThreadDates {
        due_on: Some(friday()),
        event_on: NaiveDate::from_ymd_opt(2026, 10, 12),
    }));
    let id = insert(&store, thread(OWNER));

    due_date_service(&store, &classifier, &due_dates, Some("America/New_York"))
        .classify_thread(id)
        .await
        .unwrap();

    // The due day comes at the owner's midnight, and the meeting is over at
    // the next one after its day.
    assert_eq!(store.saved.lock().unwrap()[0].dates, stored_dates());
}

#[tokio::test]
async fn a_meeting_counts_for_nothing_while_its_deadline_lasts_longer() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(ThreadDates {
        due_on: NaiveDate::from_ymd_opt(2026, 10, 12),
        event_on: Some(friday()),
    }));
    let id = insert(&store, thread(OWNER));

    due_date_service(&store, &classifier, &due_dates, None)
        .classify_thread(id)
        .await
        .unwrap();

    let saved = store.saved.lock().unwrap()[0].dates;
    assert_eq!(saved.due_on, NaiveDate::from_ymd_opt(2026, 10, 12));
    // With no zone, a day counts once it has begun everywhere.
    assert_eq!(
        saved.due_at,
        Some(Utc.with_ymd_and_hms(2026, 10, 12, 12, 0, 0).unwrap())
    );
    assert_eq!(saved.event_over_at, None);
}

#[tokio::test]
async fn mail_the_read_never_saw_still_measures_how_far_past_the_meeting_the_thread_is() {
    let store = FakeStore::default();
    // Focus, with nothing for the owner to do: notes.
    let classifier =
        FakeClassifier::answering(Ok(vec![0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    let meeting = NaiveDate::from_ymd_opt(2026, 10, 8);
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(ThreadDates {
        due_on: None,
        event_on: meeting,
    }));
    let mut mail = thread(OWNER);
    // An attachment alone, written on Oct 23 at its sender's offset, the 15th day
    // after the meeting, though still Oct 22 in New York.
    mail.messages.push(FocusMessage {
        id: Uuid::new_v4(),
        at: Utc.with_ymd_and_hms(2026, 10, 23, 0, 30, 0).unwrap(),
        body: Some(String::new()),
        date_header: Some("Fri, 23 Oct 2026 09:30:00 +0900".to_owned()),
        ..mail.messages[0].clone()
    });
    let id = insert(&store, mail);

    due_date_service(&store, &classifier, &due_dates, Some("America/New_York"))
        .classify_thread(id)
        .await
        .unwrap();

    // The read saw only the first message; the meeting is two weeks behind the
    // thread all the same, by the calendar the read counts in.
    assert_eq!(due_dates.inputs.lock().unwrap()[0].messages.len(), 1);
    assert_eq!(store.saved.lock().unwrap()[0].dates.event_over_at, None);
}

#[tokio::test]
async fn a_thread_that_cannot_be_in_focus_makes_no_model_call() {
    let store = FakeStore::default();
    // Automated, and nobody waits on it.
    let classifier =
        FakeClassifier::answering(Ok(vec![0.0, 0.0, 0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(due(friday())));
    let id = insert(&store, thread(OWNER));

    let outcome = due_date_service(&store, &classifier, &due_dates, None)
        .classify_thread(id)
        .await
        .unwrap();

    let ClassifyOutcome::Classified(verdict) = outcome else {
        panic!("expected a classification, got {outcome:?}");
    };
    assert!(!verdict.is_focus && !verdict.awaiting_reply);
    assert!(due_dates.inputs.lock().unwrap().is_empty());
    assert_eq!(store.saved.lock().unwrap()[0].dates.due_on, None);
}

#[tokio::test]
async fn a_thread_only_awaiting_a_reply_still_gets_a_due_date() {
    let store = FakeStore::default();
    // Reads as automated, so only the wait can bring it in.
    let classifier =
        FakeClassifier::answering(Ok(vec![0.0, 0.0, 0.9, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(due(friday())));
    let mut waiting = thread(OWNER);
    let mut reply = waiting.messages[0].clone();
    reply.id = Uuid::new_v4();
    reply.at = noon() + Duration::hours(1);
    reply.is_sent = true;
    reply.from_email = Some("owner@acme.example".to_owned());
    reply.to = vec!["ceo@customer.example".to_owned()];
    reply.body = Some("Can you resend the invoice by Friday?".to_owned());
    waiting.messages.push(reply);
    let id = insert(&store, waiting);

    let outcome = due_date_service(&store, &classifier, &due_dates, None)
        .classify_thread(id)
        .await
        .unwrap();

    let ClassifyOutcome::Classified(verdict) = outcome else {
        panic!("expected a classification, got {outcome:?}");
    };
    assert!(!verdict.is_focus && verdict.awaiting_reply);
    assert_eq!(store.saved.lock().unwrap()[0].dates.due_on, Some(friday()));
}

#[tokio::test]
async fn deciding_again_keeps_the_stored_dates_and_calls_no_model() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Unavailable));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(ThreadDates::default()));
    let mut legacy = thread(OWNER);
    legacy.classified = Some(StoredClassification {
        dates: stored_dates(),
        ..stored_at(&legacy, 0)
    });
    let id = insert(&store, legacy);

    let outcome = due_date_service(&store, &classifier, &due_dates, None)
        .classify_thread(id)
        .await
        .unwrap();

    assert!(matches!(outcome, ClassifyOutcome::Redecided(_)));
    assert!(due_dates.inputs.lock().unwrap().is_empty());
    assert!(classifier.inputs.lock().unwrap().is_empty());
    assert_eq!(store.saved.lock().unwrap()[0].dates, stored_dates());
}

#[tokio::test]
async fn new_mail_with_no_deadline_or_meeting_clears_the_stored_dates() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(ThreadDates::default()));
    let mut stale = thread(OWNER);
    stale.classified = Some(StoredClassification {
        message_id: Uuid::new_v4(),
        rule_version: FOCUS_RULE_VERSION,
        answers: None,
        model: "jev-earlier".to_owned(),
        dates: stored_dates(),
    });
    let id = insert(&store, stale);

    let outcome = due_date_service(&store, &classifier, &due_dates, None)
        .classify_thread(id)
        .await
        .unwrap();

    assert!(matches!(outcome, ClassifyOutcome::Classified(_)));
    assert_eq!(due_dates.inputs.lock().unwrap().len(), 1);
    assert_eq!(store.saved.lock().unwrap()[0].dates, FocusDates::default());
}

#[tokio::test]
async fn a_failed_extraction_leaves_the_classification_intact() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Fails);
    let id = insert(&store, thread(OWNER));

    let outcome = due_date_service(&store, &classifier, &due_dates, None)
        .classify_thread(id)
        .await
        .unwrap();

    let ClassifyOutcome::Classified(verdict) = outcome else {
        panic!("expected a classification, got {outcome:?}");
    };
    assert!(verdict.is_focus && verdict.needs_reply);
    let saved = store.saved.lock().unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].dates.due_on, None);
}

#[tokio::test(start_paused = true)]
async fn a_hung_extraction_only_costs_the_timeout() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Hangs);
    let id = insert(&store, thread(OWNER));
    let started = tokio::time::Instant::now();

    let outcome = due_date_service(&store, &classifier, &due_dates, None)
        .classify_thread(id)
        .await
        .unwrap();

    assert!(matches!(outcome, ClassifyOutcome::Classified(_)));
    assert_eq!(started.elapsed(), DUE_DATE_TIMEOUT);
    assert_eq!(store.saved.lock().unwrap()[0].dates.due_on, None);
}

#[tokio::test]
async fn a_thread_with_no_words_of_its_own_makes_no_model_call() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(due(friday())));
    let mut quoted = thread(OWNER);
    quoted.messages[0].body = Some("> Please send it by Friday.".to_owned());
    let id = insert(&store, quoted);

    due_date_service(&store, &classifier, &due_dates, None)
        .classify_thread(id)
        .await
        .unwrap();

    assert!(due_dates.inputs.lock().unwrap().is_empty());
    assert_eq!(store.saved.lock().unwrap()[0].dates.due_on, None);
}

#[tokio::test]
async fn the_owners_time_zone_sets_the_day_a_message_counts_from() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(ThreadDates::default()));
    let mut late_evening = thread(OWNER);
    late_evening.messages[0].at = Utc.with_ymd_and_hms(2026, 10, 8, 2, 0, 0).unwrap();
    let id = insert(&store, late_evening);

    due_date_service(&store, &classifier, &due_dates, Some("America/New_York"))
        .classify_thread(id)
        .await
        .unwrap();

    assert_eq!(
        due_dates.inputs.lock().unwrap()[0].messages[0].written_on,
        NaiveDate::from_ymd_opt(2026, 10, 7).unwrap()
    );
}

#[tokio::test]
async fn an_unknown_time_zone_falls_back_without_failing() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(ThreadDates::default()));
    let mut late_evening = thread(OWNER);
    late_evening.messages[0].at = Utc.with_ymd_and_hms(2026, 10, 8, 2, 0, 0).unwrap();
    let id = insert(&store, late_evening);

    due_date_service(
        &store,
        &classifier,
        &due_dates,
        Some("Pacific Standard Time"),
    )
    .classify_thread(id)
    .await
    .unwrap();

    assert_eq!(
        due_dates.inputs.lock().unwrap()[0].messages[0].written_on,
        NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()
    );
}

/// A connected inbox for `owner_email`, listed with the store's syncing inboxes.
fn connect(store: &FakeStore, owner_email: &str) -> FocusInboxOwner {
    let inbox = FocusInboxOwner {
        link_id: Uuid::new_v4(),
        owner: owner(owner_email),
        delegates: Vec::new(),
    };
    store.syncing.lock().unwrap().push(inbox.clone());
    inbox
}

#[tokio::test]
async fn a_look_finds_enrolled_inboxes_before_any_mail_and_the_sweep_covers_them() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let ours = connect(&store, OWNER);
    connect(&store, "other@acme.example");
    let enrollment = enrolled();
    let service = service(&store, &classifier, &enrollment);

    let found = service.enrolled_inboxes(4).await.unwrap();
    assert_eq!(
        found,
        EnrolledInboxes {
            enrolled: vec![ours.clone()],
            unknown: 0,
        }
    );
    // Nothing in the inbox holds Focus, yet the sweep now covers it.
    assert!(store.focus_inboxes.lock().unwrap().is_empty());
    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!(report.inboxes, 1);
    assert_eq!(*store.stale_reads.lock().unwrap(), vec![ours.link_id]);
}

#[tokio::test]
async fn a_look_counts_owners_whose_rollout_is_unknown() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    connect(&store, OWNER);
    let down = FakeEnrollment {
        down: true,
        ..enrolled()
    };

    let found = service(&store, &classifier, &down)
        .enrolled_inboxes(4)
        .await
        .unwrap();
    assert_eq!(
        found,
        EnrolledInboxes {
            enrolled: Vec::new(),
            unknown: 1,
        }
    );
}

#[tokio::test]
async fn a_backfill_classifies_every_stale_thread_in_the_inbox() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let ids: Vec<_> = (0..7).map(|_| insert(&store, thread(OWNER))).collect();
    set_stale(&store, &ids, noon());
    let service = service(&store, &classifier, &enrolled());

    let report = service
        .backfill(
            &FocusInboxOwner {
                link_id: INBOX,
                owner: owner(OWNER),
                delegates: Vec::new(),
            },
            Duration::days(30),
            3,
            DueDates::Read,
        )
        .await
        .unwrap();
    assert_eq!(
        (report.inboxes, report.candidates, report.classified),
        (1, 7, 7)
    );
    assert_eq!(store.saved.lock().unwrap().len(), 7);
    // The sweep may cover the inbox again once the backfill is done.
    assert!(service.backfilling().is_empty());
}

#[tokio::test]
async fn a_backfill_reads_no_mail_of_an_owner_outside_the_rollout() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    set_stale(&store, &[insert(&store, thread(OWNER))], noon());

    let report = service(&store, &classifier, &FakeEnrollment::default())
        .backfill(
            &FocusInboxOwner {
                link_id: INBOX,
                owner: owner(OWNER),
                delegates: Vec::new(),
            },
            Duration::days(30),
            3,
            DueDates::Read,
        )
        .await
        .unwrap();
    assert_eq!(report, SweepReport::default());
    assert!(store.stale_reads.lock().unwrap().is_empty());
    assert_eq!(*store.mail_reads.lock().unwrap(), 0);
}

#[tokio::test]
async fn a_backfill_stops_when_the_classifier_is_down() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Err(FocusClassifierError::Unavailable));
    let ids: Vec<_> = (0..20).map(|_| insert(&store, thread(OWNER))).collect();
    set_stale(&store, &ids, noon());

    let report = service(&store, &classifier, &enrolled())
        .backfill(
            &FocusInboxOwner {
                link_id: INBOX,
                owner: owner(OWNER),
                delegates: Vec::new(),
            },
            Duration::days(30),
            2,
            DueDates::Read,
        )
        .await
        .unwrap();
    assert!(report.stopped_early);
    // Only the threads already at the classifier when it said stop.
    assert!(classifier.inputs.lock().unwrap().len() <= 2);
}

#[tokio::test]
async fn the_sweep_leaves_an_inbox_being_backfilled_to_the_backfill() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    set_stale(&store, &[insert(&store, thread(OWNER))], noon());
    let service = service(&store, &classifier, &enrolled());
    service.backfilling().insert(INBOX);

    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!(report, SweepReport::default());
    assert!(store.stale_reads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_backfill_reads_due_dates_only_for_threads_active_since_its_cutoff() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let due_dates = FakeDueDates::answering(DueDateAnswer::Finds(due(friday())));
    let old: Vec<_> = (0..3).map(|_| insert(&store, thread(OWNER))).collect();
    set_stale(&store, &old, noon() - Duration::days(10));
    // Mail arriving while the pass runs is newer than the cutoff.
    let recent = insert(&store, thread(OWNER));
    store.stale.lock().unwrap().insert(
        0,
        (
            INBOX,
            StaleThread {
                thread_id: recent,
                latest_at: noon(),
            },
        ),
    );
    let service = due_date_service(&store, &classifier, &due_dates, None);
    let inbox = FocusInboxOwner {
        link_id: INBOX,
        owner: owner(OWNER),
        delegates: Vec::new(),
    };

    let report = service
        .backfill(
            &inbox,
            Duration::days(30),
            3,
            DueDates::ReadSince(noon() - Duration::days(3)),
        )
        .await
        .unwrap();
    assert_eq!(report.classified, 4);
    assert_eq!(due_dates.inputs.lock().unwrap().len(), 1);
    let saved = store.saved.lock().unwrap();
    for record in saved.iter() {
        let expected = (record.thread_id == recent).then(friday);
        assert_eq!(record.dates.due_on, expected, "{}", record.thread_id);
    }
}

/// A user the test inbox is linked to, whose Focus tab shows it too: the test
/// inbox is their secondary inbox.
const PRIMARY: &str = "primary@acme.example";

/// Link the test inbox to [`PRIMARY`].
fn link_to_primary(store: &FakeStore) {
    store
        .delegates
        .lock()
        .unwrap()
        .insert(INBOX, vec![owner(PRIMARY)]);
}

#[tokio::test]
async fn a_linked_inbox_is_classified_while_its_primary_user_is_in_the_rollout() {
    let store = FakeStore::default();
    link_to_primary(&store);
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let id = insert(&store, thread(OWNER));
    let enrollment = FakeEnrollment::enrolling(&[PRIMARY]);

    let outcome = service(&store, &classifier, &enrollment)
        .classify_thread(id)
        .await
        .unwrap();
    assert!(
        matches!(outcome, ClassifyOutcome::Classified(_)),
        "{outcome:?}"
    );
    assert_eq!(store.saved.lock().unwrap()[0].thread_id, id);
    // The owner is asked first, then the user it is linked to.
    assert_eq!(
        *enrollment.checks.lock().unwrap(),
        vec![owner(OWNER), owner(PRIMARY)]
    );
}

#[tokio::test]
async fn an_enrolled_owner_settles_it_without_asking_who_the_inbox_is_linked_to() {
    let store = FakeStore::default();
    link_to_primary(&store);
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let id = insert(&store, thread(OWNER));
    let enrollment = enrolled();

    let outcome = service(&store, &classifier, &enrollment)
        .classify_thread(id)
        .await
        .unwrap();
    assert!(
        matches!(outcome, ClassifyOutcome::Classified(_)),
        "{outcome:?}"
    );
    assert_eq!(*enrollment.checks.lock().unwrap(), vec![owner(OWNER)]);
}

#[tokio::test]
async fn a_linked_inbox_stops_when_its_primary_user_leaves_the_rollout() {
    let store = FakeStore::default();
    link_to_primary(&store);
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let enrollment = FakeEnrollment::enrolling(&[PRIMARY]);
    let service = service(&store, &classifier, &enrollment);
    set_stale(&store, &[insert(&store, thread(OWNER))], noon());
    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!((report.inboxes, report.classified), (1, 1));

    enrollment.leave(PRIMARY);
    let id = insert(&store, thread(OWNER));
    assert_eq!(
        service.classify_thread(id).await.unwrap(),
        ClassifyOutcome::NotEnabled
    );
    set_stale(&store, &[id], noon());
    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!(report, SweepReport::default());
    assert_eq!(*store.stale_reads.lock().unwrap(), vec![INBOX]);
    assert_eq!(*store.mail_reads.lock().unwrap(), 1);
}

#[tokio::test]
async fn a_linked_inbox_drops_out_once_it_is_unlinked() {
    let store = FakeStore::default();
    link_to_primary(&store);
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let enrollment = FakeEnrollment::enrolling(&[PRIMARY]);
    let service = service(&store, &classifier, &enrollment);
    set_stale(&store, &[insert(&store, thread(OWNER))], noon());
    assert_eq!(
        service
            .sweep(Duration::days(30), 100)
            .await
            .unwrap()
            .inboxes,
        1
    );

    // Who it is linked to as just read wins over what the sweep remembered.
    store.delegates.lock().unwrap().clear();
    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!(report.inboxes, 0);
    assert!(service.enrolled().is_empty());
}

#[tokio::test]
async fn a_thread_found_out_of_the_rollout_is_checked_again_once_its_inbox_is_back_in() {
    let store = FakeStore::default();
    link_to_primary(&store);
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let enrollment = FakeEnrollment::enrolling(&[PRIMARY]);
    let service = service(&store, &classifier, &enrollment);
    // Mail arrives: the inbox joins the sweep through its primary user,
    // holding no Focus yet.
    service
        .classify_thread(insert(&store, thread(OWNER)))
        .await
        .unwrap();
    for _ in 0..2 {
        let thread_id = insert(&store, thread(OWNER));
        store.stale.lock().unwrap().push((
            INBOX,
            StaleThread {
                thread_id,
                latest_at: noon(),
            },
        ));
    }
    assert!(store.focus_inboxes.lock().unwrap().is_empty());

    // Unlinked after the sweep remembered whom: the first thread finds the
    // inbox out, and the rest of it is left unread.
    store.delegates.lock().unwrap().clear();
    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!(
        (
            report.inboxes,
            report.inboxes_left,
            report.candidates,
            report.skipped
        ),
        (1, 1, 2, 1)
    );
    assert!(service.settled().is_empty());
    assert_eq!(*store.mail_reads.lock().unwrap(), 1);

    // Linked again: both threads are classified, none skipped as checked.
    link_to_primary(&store);
    let inbox = FocusInboxOwner {
        link_id: INBOX,
        owner: owner(OWNER),
        delegates: vec![owner(PRIMARY)],
    };
    let report = service
        .backfill(&inbox, Duration::days(30), 3, DueDates::Read)
        .await
        .unwrap();
    assert_eq!(
        (report.inboxes, report.classified, report.skipped),
        (1, 2, 0)
    );
}

#[tokio::test]
async fn a_primary_user_who_joins_gets_their_linked_inbox_found_and_backfilled() {
    let store = FakeStore::default();
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let linked = connect(&store, OWNER);
    store
        .delegates
        .lock()
        .unwrap()
        .insert(linked.link_id, vec![owner(PRIMARY)]);
    let mut mail = thread(OWNER);
    mail.link_id = linked.link_id;
    let id = insert(&store, mail);
    store.stale.lock().unwrap().push((
        linked.link_id,
        StaleThread {
            thread_id: id,
            latest_at: noon(),
        },
    ));
    let enrollment = FakeEnrollment::default();
    let service = service(&store, &classifier, &enrollment);
    assert_eq!(
        service.enrolled_inboxes(4).await.unwrap(),
        EnrolledInboxes::default()
    );

    enrollment.enroll(PRIMARY);
    let found = service.enrolled_inboxes(4).await.unwrap();
    let inbox = FocusInboxOwner {
        delegates: vec![owner(PRIMARY)],
        ..linked
    };
    assert_eq!(
        found,
        EnrolledInboxes {
            enrolled: vec![inbox.clone()],
            unknown: 0,
        }
    );
    let report = service
        .backfill(&inbox, Duration::days(30), 3, DueDates::Read)
        .await
        .unwrap();
    assert_eq!((report.inboxes, report.classified), (1, 1));
    assert_eq!(store.saved.lock().unwrap()[0].thread_id, id);
}

#[tokio::test]
async fn a_backfill_reads_no_mail_once_the_primary_user_has_left() {
    let store = FakeStore::default();
    link_to_primary(&store);
    let classifier = FakeClassifier::answering(Ok(relevant()));
    set_stale(&store, &[insert(&store, thread(OWNER))], noon());

    let report = service(&store, &classifier, &FakeEnrollment::default())
        .backfill(
            &FocusInboxOwner {
                link_id: INBOX,
                owner: owner(OWNER),
                delegates: vec![owner(PRIMARY)],
            },
            Duration::days(30),
            3,
            DueDates::Read,
        )
        .await
        .unwrap();
    assert_eq!(report, SweepReport::default());
    assert_eq!(*store.mail_reads.lock().unwrap(), 0);
}

#[tokio::test]
async fn an_unreadable_owner_does_not_hold_back_an_enrolled_primary_user() {
    let store = FakeStore::default();
    link_to_primary(&store);
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let id = insert(&store, thread(OWNER));
    let enrollment = FakeEnrollment::enrolling(&[PRIMARY]);
    enrollment.unreadable.lock().unwrap().insert(owner(OWNER));

    let outcome = service(&store, &classifier, &enrollment)
        .classify_thread(id)
        .await
        .unwrap();
    assert!(
        matches!(outcome, ClassifyOutcome::Classified(_)),
        "{outcome:?}"
    );
}

#[tokio::test]
async fn a_linked_inbox_is_unknown_when_a_place_fails_and_nobody_is_in() {
    let store = FakeStore::default();
    link_to_primary(&store);
    let classifier = FakeClassifier::answering(Ok(relevant()));
    let id = insert(&store, thread(OWNER));
    let enrollment = FakeEnrollment::default();
    enrollment.unreadable.lock().unwrap().insert(owner(PRIMARY));
    let service = service(&store, &classifier, &enrollment);

    assert!(service.classify_thread(id).await.is_err());
    assert_eq!(*store.mail_reads.lock().unwrap(), 0);
    set_stale(&store, &[id], noon());
    let report = service.sweep(Duration::days(30), 100).await.unwrap();
    assert_eq!((report.inboxes, report.inboxes_unknown), (0, 1));
}
