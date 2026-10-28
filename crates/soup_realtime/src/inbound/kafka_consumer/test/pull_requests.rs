use super::*;

struct LinkedSessions {
    keys: Mutex<Vec<String>>,
    session: Entity<'static>,
    failures: usize,
}
impl PullRequestSessions for LinkedSessions {
    async fn linked_sessions(&self, key: &str) -> Result<Vec<Entity<'static>>, Report> {
        let mut keys = self.keys.lock().unwrap();
        keys.push(key.to_owned());
        if keys.len() <= self.failures {
            return Err(rootcause::report!("temporary session lookup failure"));
        }
        Ok(vec![self.session.clone(), self.session.clone()])
    }
}

fn pr_updated_event(foreign_entity_ids: Vec<Uuid>) -> DeclaredMacroEvent {
    DeclaredMacroEvent::GithubPullRequestMacroEvent(GithubPullRequestMacroEvent::updated(
        github_pull_requests::domain::events::GithubPullRequestUpdated {
            github_key: "macro/app/pull/7".into(),
            foreign_entity_ids,
        },
    ))
}

#[tokio::test]
async fn pr_update_targets_exact_records_and_deduplicated_linked_sessions() {
    let foreign = Uuid::now_v7();
    let sessions = LinkedSessions {
        keys: Mutex::default(),
        session: entity(EntityType::AgentSession, Uuid::now_v7()),
        failures: 0,
    };
    let event = pr_updated_event(vec![foreign]);
    let service = flaky_service(0);
    let commits = AtomicUsize::new(0);
    assert!(matches!(
        process_event(&service, &sessions, &event, || {
            commits.fetch_add(1, Ordering::SeqCst);
        })
        .await,
        EventOutcome::Notified
    ));
    assert_eq!(*sessions.keys.lock().unwrap(), vec!["macro/app/pull/7"]);
    let patches = service.patches.lock().unwrap();
    assert_eq!(patches.len(), 2);
    assert_eq!(patches[0], update(EntityType::ForeignEntity, foreign));
    assert_eq!(
        patches[1],
        SoupRealtimePatch::for_entity(Patch::Updated(sessions.session.clone()))
    );
    assert_eq!(commits.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn exhausted_session_lookup_retries_still_publish_pr_records_before_committing() {
    let foreign_ids = vec![Uuid::now_v7(), Uuid::now_v7()];
    let event = pr_updated_event(foreign_ids.clone());
    let sessions = LinkedSessions {
        keys: Mutex::default(),
        session: entity(EntityType::AgentSession, Uuid::now_v7()),
        failures: MAX_NOTIFY_ATTEMPTS,
    };
    let service = flaky_service(0);
    let commits = AtomicUsize::new(0);
    let started = tokio::time::Instant::now();
    let expected = foreign_ids
        .into_iter()
        .map(|id| update(EntityType::ForeignEntity, id))
        .collect::<Vec<_>>();

    let outcome = process_event(&service, &sessions, &event, || {
        assert_eq!(sessions.keys.lock().unwrap().len(), MAX_NOTIFY_ATTEMPTS);
        assert_eq!(*service.patches.lock().unwrap(), expected);
        commits.fetch_add(1, Ordering::SeqCst);
    })
    .await;

    assert!(matches!(outcome, EventOutcome::Notified));
    assert_eq!(commits.load(Ordering::SeqCst), 1);
    assert_eq!(started.elapsed(), Duration::from_secs(15));
}

#[tokio::test(start_paused = true)]
async fn transient_session_lookup_failures_publish_records_and_sessions_once() {
    let foreign = Uuid::now_v7();
    let event = pr_updated_event(vec![foreign]);
    let sessions = LinkedSessions {
        keys: Mutex::default(),
        session: entity(EntityType::AgentSession, Uuid::now_v7()),
        failures: MAX_NOTIFY_ATTEMPTS - 1,
    };
    let service = flaky_service(0);
    let commits = AtomicUsize::new(0);
    let expected = vec![
        update(EntityType::ForeignEntity, foreign),
        SoupRealtimePatch::for_entity(Patch::Updated(sessions.session.clone())),
    ];

    let outcome = process_event(&service, &sessions, &event, || {
        assert_eq!(*service.patches.lock().unwrap(), expected);
        commits.fetch_add(1, Ordering::SeqCst);
    })
    .await;

    assert!(matches!(outcome, EventOutcome::Notified));
    assert_eq!(sessions.keys.lock().unwrap().len(), MAX_NOTIFY_ATTEMPTS);
    assert_eq!(commits.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn cancellation_during_session_lookup_backoff_leaves_event_uncommitted() {
    let event = pr_updated_event(vec![Uuid::now_v7()]);
    let sessions = LinkedSessions {
        keys: Mutex::default(),
        session: entity(EntityType::AgentSession, Uuid::now_v7()),
        failures: MAX_NOTIFY_ATTEMPTS,
    };
    let service = flaky_service(0);
    let commits = AtomicUsize::new(0);
    {
        let process = process_event(&service, &sessions, &event, || {
            commits.fetch_add(1, Ordering::SeqCst);
        });
        tokio::pin!(process);
        assert!(futures::poll!(&mut process).is_pending());
        assert_eq!(sessions.keys.lock().unwrap().len(), 1);
    }

    assert!(service.patches.lock().unwrap().is_empty());
    assert_eq!(commits.load(Ordering::SeqCst), 0);
}
