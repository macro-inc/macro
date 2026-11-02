use super::*;

struct OnPlan(PlanTier);

impl RoutinePlans for OnPlan {
    async fn plan(&self, _owner: &MacroUserIdStr<'static>) -> Result<PlanTier> {
        Ok(self.0)
    }
}

struct PlansUnavailable;

impl RoutinePlans for PlansUnavailable {
    async fn plan(&self, _owner: &MacroUserIdStr<'static>) -> Result<PlanTier> {
        bail!("billing is unavailable")
    }
}

fn limit_reached(error: &anyhow::Error) -> Option<RoutineLimit> {
    match error.downcast_ref::<ActionPolicyError>() {
        Some(ActionPolicyError::RoutineLimitReached(limit)) => Some(*limit),
        _ => None,
    }
}

fn paused() -> ActionConfiguration {
    ActionConfiguration {
        enabled: false,
        ..configuration(false)
    }
}

#[tokio::test]
async fn free_owner_cannot_activate_an_eleventh_routine_but_can_save_it_paused() {
    let svc = service(false);
    for _ in 0..10 {
        svc.create_action(&user_principal(), configuration(false))
            .await
            .unwrap();
    }

    let error = svc
        .create_action(&user_principal(), configuration(false))
        .await
        .unwrap_err();
    let limit = limit_reached(&error).expect("routine limit refusal");
    assert_eq!(limit.plan(), PlanTier::Free);
    assert_eq!(limit.max_active(), 10);
    assert_eq!(stored_actions(&svc).len(), 10);

    svc.create_action(&user_principal(), paused())
        .await
        .unwrap();
    assert_eq!(stored_actions(&svc).len(), 11);
}

#[tokio::test]
async fn the_owners_plan_sets_the_limit() {
    let base = service(false);
    let svc = TestService::new(
        base.repo.clone(),
        base.executor.clone(),
        base.dispatcher_tx.clone(),
        grants(&base.repo),
    )
    .with_routine_plans(OnPlan(PlanTier::Premium));
    for _ in 0..11 {
        svc.create_action(&user_principal(), configuration(false))
            .await
            .unwrap();
    }
    assert_eq!(stored_actions(&base).len(), 11);
}

#[tokio::test]
async fn enabling_a_paused_routine_counts_against_the_limit() {
    let svc = service(false);
    let paused_id = svc
        .create_action(&user_principal(), paused())
        .await
        .unwrap()
        .id
        .unwrap();
    let mut active = Vec::new();
    for _ in 0..10 {
        let created = svc
            .create_action(&user_principal(), configuration(false))
            .await
            .unwrap();
        active.push(created.id.unwrap());
    }

    let error = svc
        .set_enabled(edit_receipt(paused_id), true)
        .await
        .unwrap_err();
    assert!(limit_reached(&error).is_some());
    let error = svc
        .update_action(edit_receipt(paused_id), update(configuration(false)))
        .await
        .unwrap_err();
    assert!(limit_reached(&error).is_some());
    assert!(!svc.get_action(paused_id).await.unwrap().enabled);

    svc.set_enabled(edit_receipt(active[0]), false)
        .await
        .unwrap();
    assert!(
        svc.set_enabled(edit_receipt(paused_id), true)
            .await
            .unwrap()
            .enabled
    );
}

#[tokio::test]
async fn rescheduling_a_finished_one_off_counts_against_the_limit() {
    let svc = service(false);
    let finished_id = svc
        .create_action(&user_principal(), configuration(false))
        .await
        .unwrap()
        .id
        .unwrap();
    // A one-off that has fired keeps its row, enabled, with no next run.
    svc.repo
        .actions
        .lock()
        .unwrap()
        .iter_mut()
        .find(|action| action.id == Some(finished_id))
        .unwrap()
        .next_run_at = None;
    for _ in 0..10 {
        svc.create_action(&user_principal(), configuration(false))
            .await
            .unwrap();
    }

    let renamed = ActionConfiguration {
        name: "renamed".into(),
        ..configuration(false)
    };
    svc.update_action(edit_receipt(finished_id), update(renamed))
        .await
        .unwrap();

    let rescheduled = ActionConfiguration {
        trigger: serde_json::from_value(
            json!({"type": "cron", "schedule": "0 0 10 * * *", "timezone": "UTC"}),
        )
        .unwrap(),
        ..configuration(false)
    };
    let error = svc
        .update_action(edit_receipt(finished_id), update(rescheduled))
        .await
        .unwrap_err();
    assert!(limit_reached(&error).is_some());
}

#[tokio::test]
async fn downgraded_owner_keeps_active_routines_without_a_plan_lookup() {
    let base = service(false);
    let on_pro = TestService::new(
        base.repo.clone(),
        base.executor.clone(),
        base.dispatcher_tx.clone(),
        grants(&base.repo),
    )
    .with_routine_plans(OnPlan(PlanTier::Premium));
    let mut active = Vec::new();
    for _ in 0..12 {
        let created = on_pro
            .create_action(&user_principal(), configuration(false))
            .await
            .unwrap();
        active.push(created.id.unwrap());
    }

    // Writes that add no active routine never ask billing.
    let unavailable = TestService::new(
        base.repo.clone(),
        base.executor.clone(),
        base.dispatcher_tx.clone(),
        grants(&base.repo),
    )
    .with_routine_plans(PlansUnavailable);
    let renamed = ActionConfiguration {
        name: "renamed".into(),
        ..configuration(false)
    };
    unavailable
        .update_action(edit_receipt(active[0]), update(renamed))
        .await
        .unwrap();
    unavailable
        .set_enabled(edit_receipt(active[1]), false)
        .await
        .unwrap();
    unavailable
        .create_action(&user_principal(), paused())
        .await
        .unwrap();

    // Back on Free, with 11 others still active, the paused one stays paused.
    let error = base
        .set_enabled(edit_receipt(active[1]), true)
        .await
        .unwrap_err();
    assert_eq!(
        limit_reached(&error).map(RoutineLimit::max_active),
        Some(10)
    );
}
