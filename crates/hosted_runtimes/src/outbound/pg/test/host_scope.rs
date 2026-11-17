use super::*;
use crate::domain::ports::HostScope;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn purchases_land_only_on_admitting_hosts(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let admitting = host(&repo, "runtime-dev-1", 31, 7, 3).await;
    // Far more room, so `reserve` would pick it first if it admitted purchases.
    let drained = host(&repo, "runtime-dev-2", 128, 0, 4).await;
    sqlx::query!(
        "UPDATE hosted_runtime_host SET admitting = false WHERE id = $1",
        drained.id.into_inner(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let reservation = reserve(&repo, standard(1)).await;

    assert_eq!(reservation.host, admitting.id);
    let allocation: Vec<HostId> = repo
        .allocation()
        .await
        .unwrap()
        .into_iter()
        .map(|allocation| allocation.host.id)
        .collect();
    assert_eq!(allocation, vec![admitting.id]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_control_plane_leases_only_its_own_hosts_effects_and_timers(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let first = host(&repo, "runtime-dev-1", 31, 7, 3).await;
    let on_first = bought(&repo, 1).await;
    // Bigger, so the next purchase lands here.
    let second = host(&repo, "runtime-dev-2", 128, 0, 4).await;
    let on_second = bought(&repo, 2).await;
    assert_eq!((on_first.host, on_second.host), (first.id, second.id));
    for computer in [&on_first, &on_second] {
        sqlx::query!(
            "INSERT INTO hosted_runtime_timer (computer_id, kind, fire_at) VALUES ($1, $2, $3)",
            computer.id.as_uuid(),
            TimerKind::RetentionExpired as TimerKind,
            now(),
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    let leased: Vec<ComputerId> = repo
        .lease_effects(
            EffectWorker::Fleet,
            HostScope::Only(vec![first.id]),
            10,
            now(),
            now() + Duration::minutes(1),
        )
        .await
        .unwrap()
        .into_iter()
        .map(|effect| effect.computer_id)
        .collect();
    let due: Vec<ComputerId> = repo
        .due_timers(HostScope::Only(vec![first.id]), now(), 10)
        .await
        .unwrap()
        .into_iter()
        .map(|timer| timer.computer_id)
        .collect();

    assert_eq!(leased, vec![on_first.id]);
    assert_eq!(due, vec![on_first.id]);
    let leased_for_second: Vec<ComputerId> = repo
        .lease_effects(
            EffectWorker::Fleet,
            HostScope::Only(vec![second.id]),
            10,
            now(),
            now() + Duration::minutes(1),
        )
        .await
        .unwrap()
        .into_iter()
        .map(|effect| effect.computer_id)
        .collect();
    assert_eq!(leased_for_second, vec![on_second.id]);
}
