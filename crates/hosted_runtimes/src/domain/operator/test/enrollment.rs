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
        assert_eq!(
            operator
                .repo
                .get(id)
                .await
                .unwrap()
                .unwrap()
                .into_healthy()
                .unwrap()
                .enrollment_generation,
            EnrollmentGeneration::new(1)
        );
        if existing {
            operator.run_fleet_effects().await.unwrap();
        }
        operator.harnesses.claimed.store(claimed, Ordering::SeqCst);
        let previous_pairings = operator.harnesses.enrollments.lock().unwrap().len();
        operator.fleet.calls.lock().unwrap().clear();
        let effect = Effect::Create {
            host: HOST,
            start: true,
            generation: EnrollmentGeneration::new(1),
        };
        operator.carry_out(id, &effect).await.unwrap();
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
                .into_healthy()
                .unwrap()
                .enrollment_generation,
            EnrollmentGeneration::new(1)
        );
        let enrollments = operator.fleet.enrollments.lock().unwrap();
        let secrets: Vec<_> = enrollments
            .iter()
            .map(|(enrollment, _)| enrollment.device_secret.expose().to_owned())
            .collect();
        let outbox = operator.repo.effects.lock().unwrap();
        for pending in outbox.iter() {
            let json = serde_json::to_string(&pending.effect).unwrap();
            for secret in &secrets {
                assert!(!json.contains(secret.as_str()));
            }
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
        for secret in &secrets {
            assert!(!state.contains(secret.as_str()));
        }
    }
}

#[tokio::test]
async fn instance_loss_advances_generation_and_issues_a_fresh_pairing() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
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
            .into_healthy()
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
            .into_healthy()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(2)
    );
    assert_eq!(operator.harnesses.enrollments.lock().unwrap().len(), 2);
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
            .into_healthy()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(1)
    );
    assert!(operator.harnesses.enrollments.lock().unwrap().is_empty());
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
            .into_healthy()
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
        .harnesses
        .lose_response
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
            .into_healthy()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(1)
    );
    assert!(operator.fleet.enrollments.lock().unwrap().is_empty());
    operator.carry_out(id, &effect).await.unwrap();
    assert_eq!(operator.harnesses.enrollments.lock().unwrap().len(), 2);
    let enrollments = operator.fleet.enrollments.lock().unwrap();
    assert_eq!(enrollments.len(), 1);
    assert_eq!(enrollments[0].0.generation, EnrollmentGeneration::new(1));
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
    let computer = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
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
            .into_healthy()
            .unwrap()
            .enrollment_generation,
        EnrollmentGeneration::new(2)
    );
    assert_eq!(operator.harnesses.enrollments.lock().unwrap().len(), 2);
}

proptest::proptest! {
    #[test]
    fn random_events_and_effect_retries_never_rekey_a_claimed_generation(
        steps in proptest::collection::vec(0u8..7, 1..100),
    ) {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let operator = operator(FakeFleet::default()).await;
            let id = paid_computer(&operator).await;
            let mut effects: Vec<Effect> = Vec::new();
            let mut claimed_generations = std::collections::BTreeSet::new();
            for step in steps {
                let computer = operator.repo.get(id).await.unwrap().unwrap().into_healthy().unwrap();
                match step {
                    0 => {
                        // A claim belongs to the current extant guest, not a future recreate.
                        if operator.fleet.created.lock().unwrap().contains_key(&id) {
                            operator.harnesses.claimed.store(true, Ordering::SeqCst);
                            claimed_generations.insert(computer.enrollment_generation);
                        }
                    }
                    1 => {
                        operator.fleet.created.lock().unwrap().remove(&id);
                        operator.harnesses.claimed.store(false, Ordering::SeqCst);
                        operator.repo.apply(id, Event::InstanceLost, now()).await.unwrap();
                    }
                    2 => {
                        operator.repo.apply(id, Event::MacrodConnected, now()).await.unwrap();
                    }
                    3 => {
                        operator.repo.apply(id, Event::MacrodDisconnected, now()).await.unwrap();
                    }
                    _ => {
                        let effect = if step == 4 && !effects.is_empty() {
                            effects.first().unwrap().clone()
                        } else {
                            Effect::Create {
                                host: HOST,
                                start: true,
                                generation: computer.enrollment_generation,
                            }
                        };
                        let claimed = operator.harnesses.claimed.load(Ordering::SeqCst)
                            && operator.fleet.created.lock().unwrap().contains_key(&id);
                        let issued = operator.fleet.enrollments.lock().unwrap().len();
                        let pairings = operator.harnesses.enrollments.lock().unwrap().len();
                        operator.carry_out(id, &effect).await.unwrap();
                        let enrollments = operator.fleet.enrollments.lock().unwrap();
                        for (enrollment, _) in enrollments.iter().skip(issued) {
                            assert!(!claimed_generations.contains(&enrollment.generation));
                        }
                        drop(enrollments);
                        if claimed {
                            assert_eq!(operator.harnesses.enrollments.lock().unwrap().len(), pairings);
                        }
                        effects.push(effect);
                    }
                }
            }
        });
    }
}
