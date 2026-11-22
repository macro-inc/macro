use super::*;
use macro_uuid::Uuid;
use std::sync::Mutex;

#[derive(Clone, Default)]
struct Repo(Arc<Mutex<Data>>);
#[derive(Default)]
struct Data {
    explicit: ExplicitMemory,
    snapshot: MemorySnapshot,
    profiles: Vec<(String, String)>,
    writes: usize,
    claim_calls: usize,
    claims: Vec<RefreshClaim>,
    released: Vec<u8>,
    retried: Vec<(u8, Duration)>,
    staged: Vec<(NaiveDate, Piece)>,
}
impl MemoryRepo for Repo {
    async fn save_memory(&self, _: &Memory, _: MacroUserIdStr<'_>) -> Result<Uuid> {
        panic!("legacy generation must never write")
    }
    async fn get_latest_memory(&self, _: MacroUserIdStr<'_>) -> Result<Option<MemoryRecord>> {
        panic!("legacy text must not be shared")
    }
    async fn get_memory_by_id(&self, _: MacroUserIdStr<'_>, _: Uuid) -> Result<Memory> {
        panic!("unused legacy lookup")
    }
}
impl ComposedMemoryRepo for Repo {
    async fn enroll(&self, _: &MacroUserIdStr<'_>) -> Result<()> {
        Ok(())
    }
    async fn claim_refresh(&self, _: NaiveDate) -> Result<Option<RefreshClaim>> {
        let mut data = self.0.lock().unwrap();
        data.claim_calls += 1;
        Ok((!data.claims.is_empty()).then(|| data.claims.remove(0)))
    }
    async fn release_refresh(&self, claim: &RefreshClaim) -> Result<()> {
        self.0.lock().unwrap().released.push(claim.attempt);
        Ok(())
    }
    async fn retry_refresh(&self, claim: &RefreshClaim, after: Duration) -> Result<()> {
        self.0.lock().unwrap().retried.push((claim.attempt, after));
        Ok(())
    }
    async fn staged(&self, _: &MacroUserIdStr<'_>, date: NaiveDate) -> Result<StagedPieces> {
        let mut staged = StagedPieces::default();
        for (day, piece) in &self.0.lock().unwrap().staged {
            match piece {
                Piece::Activity(row) if *day == date => staged.activity.push(row.clone()),
                Piece::Profile(profile) if *day == date => staged.profile = Some(profile.clone()),
                _ => {}
            }
        }
        Ok(staged)
    }
    async fn stage(&self, _: &MacroUserIdStr<'_>, date: NaiveDate, piece: &Piece) -> Result<()> {
        self.0.lock().unwrap().staged.push((date, piece.clone()));
        Ok(())
    }
    async fn latest_activity(&self, _: &MacroUserIdStr<'_>) -> Result<Vec<Activity>> {
        Ok(self.0.lock().unwrap().snapshot.activity.clone())
    }
    async fn explicit(&self, _: &MacroUserIdStr<'_>) -> Result<ExplicitMemory> {
        Ok(self.0.lock().unwrap().explicit.clone())
    }
    async fn save_explicit(
        &self,
        _: &MacroUserIdStr<'_>,
        expected: i64,
        content: &str,
    ) -> Result<ExplicitMemory> {
        let mut data = self.0.lock().unwrap();
        if data.explicit.revision != expected {
            return Err(MemoryError::Conflict);
        }
        data.explicit = ExplicitMemory {
            revision: expected + 1,
            content: content.to_owned(),
        };
        data.writes += 1;
        Ok(data.explicit.clone())
    }
    async fn snapshot(&self, _: &MacroUserIdStr<'_>, _: NaiveDate) -> Result<MemorySnapshot> {
        Ok(self.0.lock().unwrap().snapshot.clone())
    }
    async fn save_generation(
        &self,
        _: &MacroUserIdStr<'_>,
        expected: i64,
        date: NaiveDate,
        profile: Option<&str>,
        activity: &[Activity],
        _: &[Uuid],
    ) -> Result<()> {
        let mut data = self.0.lock().unwrap();
        if data.snapshot.revision != expected {
            return Err(MemoryError::Conflict);
        }
        data.snapshot = MemorySnapshot {
            revision: expected + 1,
            first_date: data.snapshot.first_date,
            through_date: Some(date),
            profile: profile.map_or_else(|| data.snapshot.profile.clone(), str::to_owned),
            activity: activity.to_vec(),
        };
        data.staged.clear();
        data.writes += 1;
        Ok(())
    }
    async fn profiles(&self, users: &[String]) -> Result<Vec<(String, String)>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .profiles
            .iter()
            .filter(|(u, _)| users.contains(u))
            .cloned()
            .collect())
    }
    async fn activity(
        &self,
        _: &MacroUserIdStr<'_>,
        _: NaiveDate,
        _: NaiveDate,
    ) -> Result<Vec<Activity>> {
        Ok(self.0.lock().unwrap().snapshot.activity.clone())
    }
}

const PROFILE: &str = "Engineer profile";

#[derive(Default)]
struct Generator {
    inputs: Mutex<Vec<(String, String)>>,
}
#[async_trait::async_trait]
impl MemoryGenerator for Generator {
    async fn research(&self, _: MacroUserIdStr<'static>, instructions: &str) -> Result<String> {
        self.inputs
            .lock()
            .unwrap()
            .push((instructions.into(), String::new()));
        if instructions.contains("own activity on") {
            Ok("Verified work".into())
        } else {
            Ok(PROFILE.into())
        }
    }
    async fn summarize(
        &self,
        _: MacroUserIdStr<'static>,
        instructions: &str,
        sources: &str,
    ) -> Result<String> {
        self.inputs
            .lock()
            .unwrap()
            .push((instructions.into(), sources.into()));
        Ok("Project progress".into())
    }
}

#[derive(Default)]
struct Judge {
    /// Reject every reviewed content.
    reject: bool,
    /// Reject only this content.
    reject_content: Option<&'static str>,
    kinds: Mutex<Vec<MemoryKind>>,
}
#[async_trait::async_trait]
impl MemoryJudge for Judge {
    async fn review(
        &self,
        _: MacroUserIdStr<'static>,
        kind: MemoryKind,
        content: &str,
    ) -> Result<()> {
        self.kinds.lock().unwrap().push(kind);
        if self.reject || self.reject_content == Some(content) {
            Err(MemoryError::Rejected("private".into()))
        } else {
            Ok(())
        }
    }
}
impl Generator {
    /// Model calls so far: research and summarize.
    fn calls(&self) -> usize {
        self.inputs.lock().unwrap().len()
    }
}
impl Judge {
    fn reviews(&self) -> usize {
        self.kinds.lock().unwrap().len()
    }
}

fn rejecting() -> Arc<Judge> {
    Arc::new(Judge {
        reject: true,
        ..Default::default()
    })
}

struct Teams(Mutex<Vec<(Uuid, Vec<String>)>>);
#[async_trait::async_trait]
impl MemoryTeams for Teams {
    async fn members(&self, _: &MacroUserIdStr<'_>) -> Result<Vec<(Uuid, Vec<String>)>> {
        Ok(self.0.lock().unwrap().clone())
    }
}
/// The activity log: every day has activity when `acted`, and the user is
/// around when `around` is `Some(true)`; `None` fails the read.
struct Active {
    acted: bool,
    around: Mutex<Option<bool>>,
    /// The `since` of every `used_since` read, in order.
    asked: Mutex<Vec<chrono::DateTime<Utc>>>,
}
impl Active {
    fn new(acted: bool, around: Option<bool>) -> Arc<Self> {
        Arc::new(Self {
            acted,
            around: Mutex::new(around),
            asked: Mutex::default(),
        })
    }
    fn set_around(&self, around: bool) {
        *self.around.lock().unwrap() = Some(around);
    }
}
#[async_trait::async_trait]
impl MemoryActivity for Active {
    async fn acted_on(&self, _: &MacroUserIdStr<'_>, _: NaiveDate) -> Result<bool> {
        Ok(self.acted)
    }
    async fn used_since(
        &self,
        _: &MacroUserIdStr<'_>,
        since: chrono::DateTime<Utc>,
    ) -> Result<bool> {
        self.asked.lock().unwrap().push(since);
        let around = *self.around.lock().unwrap();
        around.ok_or_else(|| MemoryError::Other(anyhow::anyhow!("activity log unavailable")))
    }
}
fn active() -> Arc<dyn MemoryActivity> {
    Active::new(true, Some(true))
}
fn claim(user: &MacroUserIdStr<'static>, date: NaiveDate) -> RefreshClaim {
    RefreshClaim {
        user: user.clone(),
        date,
        token: Uuid::now_v7(),
        attempt: 1,
    }
}
fn no_teams() -> Arc<dyn MemoryTeams> {
    Arc::new(Teams(Mutex::new(vec![])))
}

#[tokio::test]
async fn rejected_preferences_never_write_but_forgetting_is_allowed() {
    let repo = Repo::default();
    repo.0.lock().unwrap().explicit = ExplicitMemory {
        content: "old sensitive content".into(),
        revision: 1,
    };
    let service = MemoryServiceImpl::new(
        repo.clone(),
        Arc::new(Generator::default()),
        rejecting(),
        Arc::new(Teams(Mutex::new(vec![]))),
        active(),
    );
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    assert!(matches!(
        service
            .update_memory(
                user.clone(),
                1,
                &MemoryEdit::Insert {
                    line: 2,
                    content: "sensitive".into()
                }
            )
            .await,
        Err(MemoryError::Rejected(_))
    ));
    assert_eq!(repo.0.lock().unwrap().writes, 0);
    let saved = service
        .update_memory(user.clone(), 1, &MemoryEdit::Delete { line: 1 })
        .await
        .unwrap();
    assert_eq!(saved.content, "");
    assert!(matches!(
        service
            .update_memory(user, 1, &MemoryEdit::Delete { line: 1 })
            .await,
        Err(MemoryError::Conflict)
    ));
    assert_eq!(repo.0.lock().unwrap().writes, 1);
}

#[tokio::test]
async fn current_membership_controls_profiles_and_activity() {
    let repo = Repo::default();
    repo.0.lock().unwrap().profiles = vec![
        (
            "macro|teammate@example.com".into(),
            "Teammate profile".into(),
        ),
        (
            "macro|stranger@example.com".into(),
            "Must stay hidden".into(),
        ),
    ];
    let teams = Arc::new(Teams(Mutex::new(vec![(
        Uuid::now_v7(),
        vec!["macro|teammate@example.com".into()],
    )])));
    let generator = Arc::new(Generator::default());
    let service = MemoryServiceImpl::new(
        repo,
        generator.clone(),
        Arc::new(Judge::default()),
        teams.clone(),
        active(),
    );
    let owner = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let teammate = MacroUserIdStr::parse_from_str("macro|teammate@example.com").unwrap();
    let date = NaiveDate::from_ymd_opt(2026, 6, 17).unwrap();
    let memory = service.get_memory(owner.clone()).await.unwrap().unwrap();
    assert!(memory.contains("Teammate profile"));
    assert!(!memory.contains("Must stay hidden"));
    assert!(generator.inputs.lock().unwrap().is_empty());
    service
        .get_user_activity(owner.clone(), teammate.clone(), date, date)
        .await
        .unwrap();
    teams.0.lock().unwrap().clear();
    assert!(matches!(
        service
            .get_user_activity(owner.clone(), teammate, date, date)
            .await,
        Err(MemoryError::Forbidden)
    ));
    assert!(service.get_memory(owner).await.unwrap().is_none());
}

#[tokio::test]
async fn failed_day_is_retried_before_later_days_and_completed_day_is_noop() {
    let repo = Repo::default();
    let date = NaiveDate::from_ymd_opt(2026, 6, 17).unwrap();
    repo.0.lock().unwrap().snapshot.through_date = Some(date - Duration::days(1));
    repo.0.lock().unwrap().explicit.content = "Never rewrite this".into();
    let generator = Arc::new(Generator::default());
    let judge = Arc::new(Judge::default());
    let service = MemoryServiceImpl::new(
        repo.clone(),
        generator.clone(),
        judge.clone(),
        no_teams(),
        active(),
    );
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    assert!(matches!(
        service
            .refresh(user.clone(), date + Duration::days(1))
            .await,
        Err(MemoryError::InvalidDate)
    ));
    assert!(generator.inputs.lock().unwrap().is_empty());
    service.refresh(user.clone(), date).await.unwrap();
    service.refresh(user, date).await.unwrap();
    let data = repo.0.lock().unwrap();
    assert_eq!(data.writes, 1);
    assert_eq!(data.snapshot.activity.len(), 4);
    assert_eq!(data.explicit.content, "Never rewrite this");
    let inputs = generator.inputs.lock().unwrap();
    assert_eq!(inputs.len(), 5);
    assert!(inputs[1].1.contains("Verified work"));
    assert!(!inputs[1].1.contains("Project progress"));
    assert_eq!(
        *judge.kinds.lock().unwrap(),
        [
            MemoryKind::Activity,
            MemoryKind::Activity,
            MemoryKind::Activity,
            MemoryKind::Activity,
            MemoryKind::Profile,
        ]
    );
}

#[tokio::test]
async fn refresh_through_fills_every_missing_day_and_rejections_write_nothing() {
    let repo = Repo::default();
    let date = NaiveDate::from_ymd_opt(2026, 6, 17).unwrap();
    repo.0.lock().unwrap().snapshot.through_date = Some(date - Duration::days(3));
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let rejected = MemoryServiceImpl::new(
        repo.clone(),
        Arc::new(Generator::default()),
        rejecting(),
        Arc::new(Teams(Mutex::new(vec![]))),
        active(),
    );
    assert!(matches!(
        rejected.refresh_through(user.clone(), date).await,
        Err(MemoryError::Rejected(_))
    ));
    assert_eq!(repo.0.lock().unwrap().writes, 0);
    let service = MemoryServiceImpl::new(
        repo.clone(),
        Arc::new(Generator::default()),
        Arc::new(Judge::default()),
        Arc::new(Teams(Mutex::new(vec![]))),
        active(),
    );
    service.refresh_through(user.clone(), date).await.unwrap();
    service.refresh_through(user, date).await.unwrap();
    let data = repo.0.lock().unwrap();
    assert_eq!(data.writes, 3);
    assert_eq!(data.snapshot.through_date, Some(date));
}

#[tokio::test]
async fn first_failed_generation_catches_up_from_enrollment() {
    let repo = Repo::default();
    let date = NaiveDate::from_ymd_opt(2026, 6, 17).unwrap();
    repo.0.lock().unwrap().snapshot.first_date = Some(date - Duration::days(2));
    let service = MemoryServiceImpl::new(
        repo.clone(),
        Arc::new(Generator::default()),
        Arc::new(Judge::default()),
        Arc::new(Teams(Mutex::new(vec![]))),
        active(),
    );
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    assert!(matches!(
        service.refresh(user.clone(), date).await,
        Err(MemoryError::InvalidDate)
    ));
    service.refresh_through(user, date).await.unwrap();
    let data = repo.0.lock().unwrap();
    assert_eq!(data.writes, 3);
    assert_eq!(data.snapshot.through_date, Some(date));
}

#[tokio::test]
async fn a_paused_batch_claims_nobody() {
    let repo = Repo::default();
    let service = MemoryServiceImpl::new(
        repo.clone(),
        Arc::new(Generator::default()),
        Arc::new(Judge::default()),
        no_teams(),
        active(),
    );
    service.refresh_pending(|| async { true }).await.unwrap();
    assert_eq!(repo.0.lock().unwrap().claim_calls, 0);
    service.refresh_pending(|| async { false }).await.unwrap();
    assert_eq!(repo.0.lock().unwrap().claim_calls, 1);
}

#[tokio::test]
async fn inactive_day_commits_without_model_calls() {
    let repo = Repo::default();
    let date = NaiveDate::from_ymd_opt(2026, 6, 17).unwrap();
    {
        let mut data = repo.0.lock().unwrap();
        data.snapshot.through_date = Some(date - Duration::days(1));
        data.snapshot.profile = "Existing profile".into();
    }
    let generator = Arc::new(Generator::default());
    let judge = Arc::new(Judge::default());
    let service = MemoryServiceImpl::new(
        repo.clone(),
        generator.clone(),
        judge.clone(),
        no_teams(),
        Active::new(false, Some(true)),
    );
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    service.refresh(user, date).await.unwrap();
    assert_eq!(generator.calls(), 0);
    assert_eq!(judge.reviews(), 0);
    let data = repo.0.lock().unwrap();
    assert_eq!(data.snapshot.through_date, Some(date));
    assert!(data.snapshot.activity.is_empty());
    assert_eq!(data.snapshot.profile, "Existing profile");
}

#[tokio::test]
async fn retry_reuses_pieces_that_passed_review() {
    let repo = Repo::default();
    let date = NaiveDate::from_ymd_opt(2026, 6, 17).unwrap();
    repo.0.lock().unwrap().snapshot.through_date = Some(date - Duration::days(1));
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let failing = Arc::new(Judge {
        reject_content: Some(PROFILE),
        ..Default::default()
    });
    let service = MemoryServiceImpl::new(
        repo.clone(),
        Arc::new(Generator::default()),
        failing,
        no_teams(),
        active(),
    );
    assert!(matches!(
        service.refresh(user.clone(), date).await,
        Err(MemoryError::Rejected(_))
    ));
    assert_eq!(repo.0.lock().unwrap().writes, 0);
    assert_eq!(
        repo.0.lock().unwrap().staged.len(),
        4,
        "day, week, month, summary"
    );

    let generator = Arc::new(Generator::default());
    let judge = Arc::new(Judge::default());
    let service = MemoryServiceImpl::new(
        repo.clone(),
        generator.clone(),
        judge.clone(),
        no_teams(),
        active(),
    );
    service.refresh(user, date).await.unwrap();
    let inputs = generator.inputs.lock().unwrap();
    assert_eq!(inputs.len(), 1, "only the profile is researched again");
    assert!(!inputs[0].0.contains("own activity on"));
    assert_eq!(judge.reviews(), 1);
    let data = repo.0.lock().unwrap();
    assert_eq!(data.writes, 1);
    assert_eq!(data.snapshot.profile, PROFILE);
    assert_eq!(data.snapshot.activity.len(), 4);
    assert!(data.staged.is_empty());
}

#[tokio::test]
async fn failing_day_backs_off_then_commits_kept_pieces_and_moves_on() {
    let repo = Repo::default();
    let date = Utc::now().date_naive() - Duration::days(1);
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    {
        let mut data = repo.0.lock().unwrap();
        data.snapshot.through_date = Some(date - Duration::days(1));
        data.snapshot.profile = "Existing profile".into();
        data.claims = (1..=MAX_REFRESH_ATTEMPTS)
            .map(|attempt| RefreshClaim {
                user: user.clone(),
                date,
                token: Uuid::now_v7(),
                attempt,
            })
            .collect();
    }
    let generator = Arc::new(Generator::default());
    let judge = Arc::new(Judge {
        reject_content: Some(PROFILE),
        ..Default::default()
    });
    let service =
        MemoryServiceImpl::new(repo.clone(), generator.clone(), judge, no_teams(), active());
    service.refresh_pending(|| async { false }).await.unwrap();
    let data = repo.0.lock().unwrap();
    assert_eq!(
        data.retried,
        vec![(1, Duration::hours(1)), (2, Duration::hours(2))]
    );
    assert_eq!(data.released, vec![MAX_REFRESH_ATTEMPTS]);
    assert_eq!(data.snapshot.through_date, Some(date), "the day is passed");
    assert_eq!(data.snapshot.activity.len(), 4, "reviewed reports are kept");
    assert_eq!(data.snapshot.profile, "Existing profile");
    // Rollups ran once; each retry only researched and judged the profile again.
    let summaries = generator
        .inputs
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, sources)| !sources.is_empty())
        .count();
    assert_eq!(summaries, 3);
}

#[tokio::test]
async fn claim_past_the_cap_gives_up_without_model_calls() {
    let repo = Repo::default();
    let date = Utc::now().date_naive() - Duration::days(1);
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    {
        let mut data = repo.0.lock().unwrap();
        data.snapshot.through_date = Some(date - Duration::days(1));
        // A worker crashed on its last attempt; the lease expired and was claimed again.
        data.claims = vec![RefreshClaim {
            user: user.clone(),
            date,
            token: Uuid::now_v7(),
            attempt: MAX_REFRESH_ATTEMPTS + 1,
        }];
    }
    let generator = Arc::new(Generator::default());
    let judge = Arc::new(Judge::default());
    let service = MemoryServiceImpl::new(
        repo.clone(),
        generator.clone(),
        judge.clone(),
        no_teams(),
        active(),
    );
    service.refresh_pending(|| async { false }).await.unwrap();
    assert_eq!(generator.calls(), 0);
    assert_eq!(judge.reviews(), 0);
    let data = repo.0.lock().unwrap();
    assert_eq!(data.released, vec![MAX_REFRESH_ATTEMPTS + 1]);
    assert_eq!(data.snapshot.through_date, Some(date));
    assert!(data.snapshot.activity.is_empty());
}

/// A user whose day is due yesterday, with an existing profile.
fn due_yesterday(repo: &Repo) -> (MacroUserIdStr<'static>, NaiveDate) {
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let date = Utc::now().date_naive() - Duration::days(1);
    let mut data = repo.0.lock().unwrap();
    data.snapshot.through_date = Some(date - Duration::days(1));
    data.snapshot.profile = "Existing profile".into();
    data.claims = vec![claim(&user, date)];
    (user, date)
}

#[tokio::test]
async fn an_away_user_is_not_generated_for_even_when_their_agents_worked() {
    let repo = Repo::default();
    let (_, date) = due_yesterday(&repo);
    // The day has activity (their routines ran), but they have not used Macro.
    let activity = Active::new(true, Some(false));
    let generator = Arc::new(Generator::default());
    let judge = Arc::new(Judge::default());
    let service = MemoryServiceImpl::new(
        repo.clone(),
        generator.clone(),
        judge.clone(),
        no_teams(),
        activity.clone(),
    );
    let before = Utc::now();
    service.refresh_pending(|| async { false }).await.unwrap();
    let after = Utc::now();
    assert_eq!(generator.calls(), 0);
    assert_eq!(judge.reviews(), 0);
    let data = repo.0.lock().unwrap();
    assert_eq!(data.released, vec![1], "the day is released, not retried");
    assert!(data.retried.is_empty());
    assert_eq!(data.snapshot.through_date, Some(date), "the day is passed");
    assert!(data.snapshot.activity.is_empty(), "with no report");
    assert_eq!(data.snapshot.profile, "Existing profile");
    let asked = activity.asked.lock().unwrap();
    assert_eq!(asked.len(), 1);
    assert!(before - AWAY_AFTER <= asked[0] && asked[0] <= after - AWAY_AFTER);
}

#[tokio::test]
async fn an_active_user_is_generated_for() {
    let repo = Repo::default();
    let (_, date) = due_yesterday(&repo);
    let generator = Arc::new(Generator::default());
    let service = MemoryServiceImpl::new(
        repo.clone(),
        generator.clone(),
        Arc::new(Judge::default()),
        no_teams(),
        active(),
    );
    service.refresh_pending(|| async { false }).await.unwrap();
    assert_eq!(generator.calls(), 5, "day, week, month, summary, profile");
    let data = repo.0.lock().unwrap();
    assert_eq!(data.released, vec![1]);
    assert_eq!(data.snapshot.through_date, Some(date));
    assert_eq!(data.snapshot.activity.len(), 4);
    assert_eq!(data.snapshot.profile, PROFILE);
}

#[tokio::test]
async fn an_unreadable_activity_check_still_generates() {
    let repo = Repo::default();
    let (_, date) = due_yesterday(&repo);
    let generator = Arc::new(Generator::default());
    let service = MemoryServiceImpl::new(
        repo.clone(),
        generator.clone(),
        Arc::new(Judge::default()),
        no_teams(),
        Active::new(true, None),
    );
    service.refresh_pending(|| async { false }).await.unwrap();
    assert_eq!(generator.calls(), 5);
    assert_eq!(repo.0.lock().unwrap().snapshot.through_date, Some(date));
}

#[tokio::test]
async fn a_returning_user_is_generated_for_from_their_return_without_the_missed_days() {
    let repo = Repo::default();
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let yesterday = Utc::now().date_naive() - Duration::days(1);
    let away_days = [yesterday - Duration::days(2), yesterday - Duration::days(1)];
    repo.0.lock().unwrap().snapshot.through_date = Some(away_days[0] - Duration::days(1));
    let activity = Active::new(true, Some(false));
    let generator = Arc::new(Generator::default());
    let service = MemoryServiceImpl::new(
        repo.clone(),
        generator.clone(),
        Arc::new(Judge::default()),
        no_teams(),
        activity.clone(),
    );
    // Each day is claimed as it comes due; the user is away for the first two.
    for day in away_days {
        repo.0.lock().unwrap().claims = vec![claim(&user, day)];
        service.refresh_pending(|| async { false }).await.unwrap();
        assert_eq!(repo.0.lock().unwrap().snapshot.through_date, Some(day));
    }
    assert_eq!(generator.calls(), 0);
    activity.set_around(true);
    repo.0.lock().unwrap().claims = vec![claim(&user, yesterday)];
    service.refresh_pending(|| async { false }).await.unwrap();
    assert_eq!(generator.calls(), 5, "only the day after they came back");
    let inputs = generator.inputs.lock().unwrap();
    assert!(inputs[0].0.contains(&yesterday.to_string()));
    let data = repo.0.lock().unwrap();
    assert_eq!(data.writes, 3);
    assert_eq!(data.snapshot.through_date, Some(yesterday));
    let days: Vec<_> = data
        .snapshot
        .activity
        .iter()
        .filter(|report| report.granularity == Granularity::Day)
        .map(|report| report.period_start)
        .collect();
    assert_eq!(days, vec![yesterday]);
}

#[tokio::test]
async fn the_one_user_catch_up_ignores_the_away_check() {
    let repo = Repo::default();
    let date = NaiveDate::from_ymd_opt(2026, 6, 17).unwrap();
    repo.0.lock().unwrap().snapshot.through_date = Some(date - Duration::days(1));
    let activity = Active::new(true, Some(false));
    let generator = Arc::new(Generator::default());
    let service = MemoryServiceImpl::new(
        repo.clone(),
        generator.clone(),
        Arc::new(Judge::default()),
        no_teams(),
        activity.clone(),
    );
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    service.refresh_through(user, date).await.unwrap();
    assert_eq!(generator.calls(), 5);
    assert!(activity.asked.lock().unwrap().is_empty());
}

#[test]
fn retry_delay_grows_and_is_bounded() {
    let delays: Vec<_> = (1..=7).map(|a| retry_delay(a).num_hours()).collect();
    assert_eq!(delays, vec![1, 2, 4, 8, 16, 16, 16]);
    assert_eq!(retry_delay(0).num_hours(), 1);
}
