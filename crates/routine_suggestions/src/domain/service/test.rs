use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::json;

use super::*;
use crate::domain::model::{InboxMessage, RoutineSurface, SuggestionIcon, SuggestionTrigger};

#[derive(Debug, thiserror::Error)]
#[error("fake failure")]
struct FakeError;

#[derive(Default)]
struct FakeRepo {
    row: Mutex<Option<(StoredSuggestionSet, Uuid)>>,
}

impl FakeRepo {
    fn with(stored: StoredSuggestionSet) -> Self {
        Self {
            row: Mutex::new(Some((stored, Uuid::now_v7()))),
        }
    }

    fn stored(&self) -> Option<StoredSuggestionSet> {
        self.row
            .lock()
            .unwrap()
            .as_ref()
            .map(|(stored, _)| stored.clone())
    }
}

impl RoutineSuggestionRepo for Arc<FakeRepo> {
    type Err = FakeError;

    async fn get(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> Result<Option<StoredSuggestionSet>, FakeError> {
        Ok(self.stored())
    }

    async fn claim(
        &self,
        _user: &MacroUserIdStr<'static>,
        generation_id: Uuid,
        now: DateTime<Utc>,
        reclaim_before: DateTime<Utc>,
    ) -> Result<bool, FakeError> {
        let mut row = self.row.lock().unwrap();
        match row.as_mut() {
            None => {
                *row = Some((
                    StoredSuggestionSet {
                        status: SuggestionSetStatus::Generating,
                        suggestions: Vec::new(),
                        started_at: now,
                        generated_at: None,
                    },
                    generation_id,
                ));
                Ok(true)
            }
            Some((stored, owner)) => {
                if stored.status == SuggestionSetStatus::Generating
                    && stored.started_at >= reclaim_before
                {
                    return Ok(false);
                }
                stored.status = SuggestionSetStatus::Generating;
                stored.started_at = now;
                *owner = generation_id;
                Ok(true)
            }
        }
    }

    async fn complete(
        &self,
        _user: &MacroUserIdStr<'static>,
        generation_id: Uuid,
        suggestions: &[RoutineSuggestion],
        now: DateTime<Utc>,
    ) -> Result<bool, FakeError> {
        let mut row = self.row.lock().unwrap();
        let Some((stored, _)) = row.as_mut().filter(|(_, owner)| *owner == generation_id) else {
            return Ok(false);
        };
        stored.status = SuggestionSetStatus::Ready;
        stored.suggestions = suggestions.to_vec();
        stored.generated_at = Some(now);
        Ok(true)
    }

    async fn fail(
        &self,
        _user: &MacroUserIdStr<'static>,
        generation_id: Uuid,
    ) -> Result<(), FakeError> {
        let mut row = self.row.lock().unwrap();
        if let Some((stored, owner)) = row.as_mut()
            && *owner == generation_id
        {
            stored.status = SuggestionSetStatus::Failed;
        }
        Ok(())
    }
}

struct FakeInbox(Option<Vec<InboxMessage>>);

impl InboxReader for FakeInbox {
    type Err = FakeError;

    async fn recent_messages(
        &self,
        _user: &MacroUserIdStr<'static>,
        _limit: u16,
    ) -> Result<Vec<InboxMessage>, FakeError> {
        self.0.clone().ok_or(FakeError)
    }
}

#[derive(Default)]
struct FakeGenerator {
    answer: Option<serde_json::Value>,
    calls: AtomicUsize,
    prompts: Mutex<Vec<String>>,
}

impl SuggestionGenerator for Arc<FakeGenerator> {
    type Err = FakeError;

    async fn generate(
        &self,
        _user: &MacroUserIdStr<'static>,
        _system_prompt: &str,
        user_prompt: String,
        _schema: serde_json::Value,
    ) -> Result<serde_json::Value, FakeError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.prompts.lock().unwrap().push(user_prompt);
        self.answer.clone().ok_or(FakeError)
    }
}

fn answer(title: &str) -> serde_json::Value {
    json!({ "suggestions": [{
        "surface": "email",
        "title": title,
        "summary": "Tags invoices.",
        "reason": "Invoices arrive weekly",
        "instructions": "Label invoices.",
        "icon": "tag",
        "keepProbability": 0.85,
        "affectsOthers": false,
        "notify": false,
        "trigger": { "kind": "event", "event": "email.message_received" },
    }]})
}

fn suggestion(title: &str) -> RoutineSuggestion {
    RoutineSuggestion {
        surface: RoutineSurface::Email,
        title: title.to_owned(),
        summary: "Tags invoices.".to_owned(),
        reason: "Invoices arrive weekly".to_owned(),
        instructions: "Label invoices.".to_owned(),
        icon: SuggestionIcon::Tag,
        keep_probability: 0.85,
        affects_others: false,
        notify: false,
        trigger: SuggestionTrigger::Event {
            event: crate::domain::model::SuggestedEvent::EmailMessageReceived,
            condition: None,
        },
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("someone@example.com").unwrap()
}

struct Harness {
    repo: Arc<FakeRepo>,
    generator: Arc<FakeGenerator>,
    tasks: TaskTracker,
    service: RoutineSuggestionService<Arc<FakeRepo>, FakeInbox, Arc<FakeGenerator>>,
}

impl Harness {
    fn new(
        repo: FakeRepo,
        inbox: Option<Vec<InboxMessage>>,
        answer: Option<serde_json::Value>,
    ) -> Self {
        let repo = Arc::new(repo);
        let generator = Arc::new(FakeGenerator {
            answer,
            ..FakeGenerator::default()
        });
        let tasks = TaskTracker::new();
        let service = RoutineSuggestionService::new(
            repo.clone(),
            FakeInbox(inbox),
            generator.clone(),
            tasks.clone(),
            CancellationToken::new(),
        );
        Self {
            repo,
            generator,
            tasks,
            service,
        }
    }

    async fn settle(&self) {
        self.tasks.close();
        self.tasks.wait().await;
    }

    fn calls(&self) -> usize {
        self.generator.calls.load(Ordering::SeqCst)
    }
}

fn ready(title: &str, generated_at: DateTime<Utc>) -> StoredSuggestionSet {
    StoredSuggestionSet {
        status: SuggestionSetStatus::Ready,
        suggestions: vec![suggestion(title)],
        started_at: generated_at,
        generated_at: Some(generated_at),
    }
}

#[tokio::test]
async fn first_read_generates_in_the_background() {
    let harness = Harness::new(
        FakeRepo::default(),
        Some(Vec::new()),
        Some(answer("Tag invoices")),
    );

    let first = harness.service.suggestions(&user()).await.unwrap();
    harness.settle().await;
    let second = harness.service.suggestions(&user()).await.unwrap();

    assert_eq!(
        first,
        RoutineSuggestionSet::empty(SuggestionSetStatus::Generating)
    );
    assert_eq!(second.status, SuggestionSetStatus::Ready);
    assert_eq!(second.suggestions, vec![suggestion("Tag invoices")]);
    assert!(second.generated_at.is_some());
    assert_eq!(harness.calls(), 1);
}

#[tokio::test]
async fn a_fresh_set_is_served_without_generating() {
    let stored = ready("Tag invoices", Utc::now() - TimeDelta::hours(1));
    let harness = Harness::new(
        FakeRepo::with(stored.clone()),
        Some(Vec::new()),
        Some(answer("New")),
    );

    let set = harness.service.suggestions(&user()).await.unwrap();
    harness.settle().await;

    assert_eq!(set, stored.into());
    assert_eq!(harness.calls(), 0);
}

#[tokio::test]
async fn a_stale_set_stays_visible_while_it_regenerates() {
    let generated_at = Utc::now() - REFRESH_AFTER - TimeDelta::minutes(1);
    let harness = Harness::new(
        FakeRepo::with(ready("Old", generated_at)),
        Some(Vec::new()),
        Some(answer("New")),
    );

    let set = harness.service.suggestions(&user()).await.unwrap();
    harness.settle().await;

    assert_eq!(set.status, SuggestionSetStatus::Generating);
    assert_eq!(set.suggestions, vec![suggestion("Old")]);
    assert_eq!(set.generated_at, Some(generated_at));
    assert_eq!(
        harness.repo.stored().unwrap().suggestions,
        vec![suggestion("New")]
    );
}

#[tokio::test]
async fn refresh_does_not_start_a_second_generation() {
    let running = StoredSuggestionSet {
        status: SuggestionSetStatus::Generating,
        suggestions: Vec::new(),
        started_at: Utc::now(),
        generated_at: None,
    };
    let harness = Harness::new(
        FakeRepo::with(running),
        Some(Vec::new()),
        Some(answer("New")),
    );

    let set = harness.service.refresh(&user()).await.unwrap();
    harness.settle().await;

    assert_eq!(set.status, SuggestionSetStatus::Generating);
    assert_eq!(harness.calls(), 0);
}

#[tokio::test]
async fn refresh_regenerates_a_fresh_set() {
    let harness = Harness::new(
        FakeRepo::with(ready("Old", Utc::now())),
        Some(Vec::new()),
        Some(answer("New")),
    );

    harness.service.refresh(&user()).await.unwrap();
    harness.settle().await;

    assert_eq!(
        harness.repo.stored().unwrap().suggestions,
        vec![suggestion("New")]
    );
}

#[tokio::test]
async fn generates_without_the_inbox_when_it_cannot_be_read() {
    let harness = Harness::new(FakeRepo::default(), None, Some(answer("Tag invoices")));

    harness.service.suggestions(&user()).await.unwrap();
    harness.settle().await;

    assert_eq!(
        harness.repo.stored().unwrap().status,
        SuggestionSetStatus::Ready
    );
    assert!(harness.generator.prompts.lock().unwrap()[0].contains("(0, newest first)"));
}

#[tokio::test]
async fn a_failed_generation_keeps_the_earlier_suggestions() {
    let generated_at = Utc::now() - REFRESH_AFTER - TimeDelta::minutes(1);
    let harness = Harness::new(
        FakeRepo::with(ready("Old", generated_at)),
        Some(Vec::new()),
        None,
    );

    harness.service.suggestions(&user()).await.unwrap();
    harness.settle().await;

    let stored = harness.repo.stored().unwrap();
    assert_eq!(stored.status, SuggestionSetStatus::Failed);
    assert_eq!(stored.suggestions, vec![suggestion("Old")]);
}

#[tokio::test]
async fn an_answer_without_usable_suggestions_fails() {
    let harness = Harness::new(
        FakeRepo::default(),
        Some(Vec::new()),
        Some(json!({ "suggestions": [{ "surface": "nowhere" }] })),
    );

    harness.service.suggestions(&user()).await.unwrap();
    harness.settle().await;

    assert_eq!(
        harness.repo.stored().unwrap().status,
        SuggestionSetStatus::Failed
    );
}

#[test]
fn decides_when_to_generate() {
    let now = Utc::now();
    let set =
        |status, started_ago: TimeDelta, generated_ago: Option<TimeDelta>| StoredSuggestionSet {
            status,
            suggestions: Vec::new(),
            started_at: now - started_ago,
            generated_at: generated_ago.map(|ago| now - ago),
        };
    let minute = TimeDelta::minutes(1);
    let cases = [
        (None, true),
        (
            Some(set(SuggestionSetStatus::Ready, minute, Some(minute))),
            false,
        ),
        (
            Some(set(
                SuggestionSetStatus::Ready,
                REFRESH_AFTER + minute,
                Some(REFRESH_AFTER + minute),
            )),
            true,
        ),
        (
            Some(set(SuggestionSetStatus::Generating, minute, None)),
            false,
        ),
        (
            Some(set(
                SuggestionSetStatus::Generating,
                RECLAIM_GENERATING_AFTER + minute,
                None,
            )),
            true,
        ),
        (Some(set(SuggestionSetStatus::Failed, minute, None)), false),
        (
            Some(set(
                SuggestionSetStatus::Failed,
                RETRY_FAILED_AFTER + minute,
                None,
            )),
            true,
        ),
    ];
    for (stored, expected) in cases {
        assert_eq!(
            needs_generation(stored.as_ref(), now),
            expected,
            "{stored:?}"
        );
    }
}
