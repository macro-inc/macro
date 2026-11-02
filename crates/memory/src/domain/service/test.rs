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
        Ok(None)
    }
    async fn release_refresh(&self, _: &RefreshClaim) -> Result<()> {
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
        profile: &str,
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
            profile: profile.to_owned(),
            activity: activity.to_vec(),
        };
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

#[derive(Default)]
struct Generator {
    reject: bool,
    inputs: Mutex<Vec<(String, String)>>,
}
#[async_trait::async_trait]
impl MemoryGenerator for Generator {
    async fn research(&self, _: MacroUserIdStr<'static>, instructions: &str) -> Result<String> {
        self.inputs
            .lock()
            .unwrap()
            .push((instructions.into(), String::new()));
        Ok("Verified work".into())
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
    async fn judge(&self, _: MacroUserIdStr<'static>, _: &str) -> Result<()> {
        if self.reject {
            Err(MemoryError::Rejected("private".into()))
        } else {
            Ok(())
        }
    }
}
struct Teams(Mutex<Vec<(Uuid, Vec<String>)>>);
#[async_trait::async_trait]
impl MemoryTeams for Teams {
    async fn members(&self, _: &MacroUserIdStr<'_>) -> Result<Vec<(Uuid, Vec<String>)>> {
        Ok(self.0.lock().unwrap().clone())
    }
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
        Arc::new(Generator {
            reject: true,
            ..Default::default()
        }),
        Arc::new(Teams(Mutex::new(vec![]))),
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
    let service = MemoryServiceImpl::new(repo, generator.clone(), teams.clone());
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
    let service = MemoryServiceImpl::new(
        repo.clone(),
        generator.clone(),
        Arc::new(Teams(Mutex::new(vec![]))),
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
}

#[tokio::test]
async fn refresh_through_fills_every_missing_day_and_rejections_write_nothing() {
    let repo = Repo::default();
    let date = NaiveDate::from_ymd_opt(2026, 6, 17).unwrap();
    repo.0.lock().unwrap().snapshot.through_date = Some(date - Duration::days(3));
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap();
    let rejected = MemoryServiceImpl::new(
        repo.clone(),
        Arc::new(Generator {
            reject: true,
            ..Default::default()
        }),
        Arc::new(Teams(Mutex::new(vec![]))),
    );
    assert!(matches!(
        rejected.refresh_through(user.clone(), date).await,
        Err(MemoryError::Rejected(_))
    ));
    assert_eq!(repo.0.lock().unwrap().writes, 0);
    let service = MemoryServiceImpl::new(
        repo.clone(),
        Arc::new(Generator::default()),
        Arc::new(Teams(Mutex::new(vec![]))),
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
        Arc::new(Teams(Mutex::new(vec![]))),
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
