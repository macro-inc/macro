use super::*;

#[tokio::test]
async fn create_rotates_only_for_a_new_or_unclaimed_guest() {
    for (existing, claimed, issue_calls, restarts) in [
        (false, false, 1, 0),
        (true, false, 1, 1),
        (true, true, 0, 0),
    ] {
        let operator = operator(FakeFleet::default()).await;
        let id = paid_computer(&operator).await;
        operator
            .credentials
            .include_persona
            .store(true, Ordering::SeqCst);
        operator.repo.computers.lock().unwrap().get_mut(&id).unwrap().persona = Some(serde_json::from_str(r#"{
            "name":"Worker","os_user":"worker","extra_service":{"unit_name":"worker","exec":"/bin/worker","env":{}},"config":{"AGENT_ID":"fixture-agent"}
        }"#).unwrap());
        assert_eq!(
            operator
                .repo
                .get(id)
                .await
                .unwrap()
                .unwrap()
                .enrollment_generation,
            EnrollmentGeneration::new(1)
        );
        if existing {
            operator.run_fleet_effects().await.unwrap();
        }
        operator.harnesses.claimed.store(claimed, Ordering::SeqCst);
        let previous_issues = operator.credentials.issues.lock().unwrap().len();
        let previous_pairings = operator.harnesses.enrollments.lock().unwrap().len();
        operator.fleet.calls.lock().unwrap().clear();
        let effect = Effect::Create {
            host: HOST,
            start: true,
            generation: EnrollmentGeneration::new(1),
        };
        operator.carry_out(id, &effect).await.unwrap();
        assert_eq!(
            operator.credentials.issues.lock().unwrap().len() - previous_issues,
            issue_calls
        );
        assert_eq!(
            operator.harnesses.enrollments.lock().unwrap().len() - previous_pairings,
            issue_calls
        );
        assert_eq!(
            operator
                .fleet
                .calls
                .lock()
                .unwrap()
                .iter()
                .filter(|call| call.starts_with("restart "))
                .count(),
            restarts
        );
        assert_eq!(
            operator
                .repo
                .get(id)
                .await
                .unwrap()
                .unwrap()
                .enrollment_generation,
            EnrollmentGeneration::new(1)
        );
        let issues = operator.credentials.issues.lock().unwrap();
        assert!(
            issues
                .iter()
                .take(issues.len() - 1)
                .all(|(_, _, revoked)| *revoked)
        );
        assert!(!issues.last().unwrap().2);
        let outbox = operator.repo.effects.lock().unwrap();
        for pending in outbox.iter() {
            let json = serde_json::to_string(&pending.effect).unwrap();
            for (_, value, _) in issues.iter() {
                assert!(!json.contains(value));
            }
            assert!(!json.contains("persona_enrollment"));
            assert!(!json.contains("https://app.example.com"));
        }
        let state = serde_json::to_string(
            &operator
                .repo
                .computers
                .lock()
                .unwrap()
                .get(&id)
                .unwrap()
                .state,
        )
        .unwrap();
        for (_, value, _) in issues.iter() {
            assert!(!state.contains(value));
        }
        if !claimed {
            let enrollments = operator.fleet.enrollments.lock().unwrap();
            let payload = &enrollments.last().unwrap().0;
            assert_eq!(
                payload
                    .persona_enrollment
                    .secrets
                    .expose()
                    .get("MACRO_API_KEY"),
                Some(&issues.last().unwrap().1)
            );
            assert_eq!(
                payload
                    .persona_enrollment
                    .env
                    .as_map()
                    .get("OVERRIDE_APP_SERVICE_URL")
                    .map(String::as_str),
                Some("https://app.example.com")
            );
        }
    }
}

#[tokio::test]
async fn instance_loss_advances_generation_and_revokes_the_previous_credentials() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    operator
        .credentials
        .include_persona
        .store(true, Ordering::SeqCst);
    operator.run_fleet_effects().await.unwrap();
    operator.harnesses.claimed.store(true, Ordering::SeqCst);
    operator.fleet.created.lock().unwrap().remove(&id);
    operator
        .repo
        .apply(id, Event::InstanceLost, now())
        .await
        .unwrap();
    assert_eq!(
        operator
            .repo
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(2)
    );
    assert!(
        operator
            .repo
            .effects
            .lock()
            .unwrap()
            .iter()
            .any(|effect| effect.effect
                == Effect::Create {
                    host: HOST,
                    start: true,
                    generation: EnrollmentGeneration::new(2),
                })
    );
    operator.run_fleet_effects().await.unwrap();
    assert_eq!(
        operator
            .repo
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(2)
    );
    let issues = operator.credentials.issues.lock().unwrap();
    assert_eq!(
        issues.as_slice(),
        &[
            (
                EnrollmentGeneration::new(1),
                "fixture-issued-value-1".to_owned(),
                true
            ),
            (
                EnrollmentGeneration::new(2),
                "fixture-issued-value-2".to_owned(),
                false
            ),
        ]
    );
    let enrollments = operator.fleet.enrollments.lock().unwrap();
    assert_eq!(enrollments[0].0.generation, EnrollmentGeneration::new(1));
    assert_eq!(enrollments[1].0.generation, EnrollmentGeneration::new(2));
    assert_ne!(enrollments[0].0.pairing_id, enrollments[1].0.pairing_id);
}

#[tokio::test]
async fn failed_fleet_creation_keeps_the_reserved_generation() {
    let operator = operator(FakeFleet {
        failures: Mutex::new(1),
        ..Default::default()
    })
    .await;
    let id = paid_computer(&operator).await;
    operator.run_fleet_effects().await.unwrap();
    assert_eq!(
        operator
            .repo
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(1)
    );
    assert!(operator.credentials.issues.lock().unwrap().is_empty());
    operator
        .carry_out(
            id,
            &Effect::Create {
                host: HOST,
                start: true,
                generation: EnrollmentGeneration::new(1),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        operator
            .repo
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(1)
    );
}

#[tokio::test]
async fn a_lost_issuance_response_is_not_replayed_and_keeps_the_reserved_generation() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    operator
        .credentials
        .include_persona
        .store(true, Ordering::SeqCst);
    operator
        .credentials
        .fail_response
        .store(true, Ordering::SeqCst);
    let effect = Effect::Create {
        host: HOST,
        start: true,
        generation: EnrollmentGeneration::new(1),
    };
    assert!(operator.carry_out(id, &effect).await.is_err());
    assert_eq!(
        operator
            .repo
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(1)
    );
    assert!(operator.fleet.enrollments.lock().unwrap().is_empty());
    operator.carry_out(id, &effect).await.unwrap();
    let issues = operator.credentials.issues.lock().unwrap();
    assert_eq!(
        issues.as_slice(),
        &[
            (
                EnrollmentGeneration::new(1),
                "fixture-issued-value-1".to_owned(),
                true
            ),
            (
                EnrollmentGeneration::new(1),
                "fixture-issued-value-2".to_owned(),
                false
            ),
        ]
    );
    assert_eq!(operator.harnesses.enrollments.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn guest_loss_during_create_reserves_a_new_generation() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    operator
        .fleet
        .lose_during_create
        .store(true, Ordering::SeqCst);
    operator.run_fleet_effects().await.unwrap();
    let computer = operator.repo.get(id).await.unwrap().unwrap();
    assert_eq!(computer.enrollment_generation, EnrollmentGeneration::new(2));
    assert!(matches!(computer.state.phase, Phase::Provisioning { .. }));
    {
        let effects = operator.repo.effects.lock().unwrap();
        let creates: Vec<_> = effects
            .iter()
            .filter(|pending| matches!(pending.effect, Effect::Create { .. }))
            .collect();
        assert_eq!(creates.len(), 1);
        assert_eq!(
            creates[0].effect,
            Effect::Create {
                host: HOST,
                start: true,
                generation: EnrollmentGeneration::new(2)
            }
        );
    }
    operator.run_fleet_effects().await.unwrap();
    assert_eq!(
        operator
            .repo
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(2)
    );
    assert_eq!(operator.credentials.issues.lock().unwrap().len(), 2);
}
