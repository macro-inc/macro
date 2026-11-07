use super::*;
use crate::outbound::postgres::test::{another_team, folder_fixture};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn empty_active_pages_advance_and_full_batches_retain_orphan_candidates(pool: PgPool) {
    let (repository, _, record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    sqlx::query!(
        r#"INSERT INTO password_item_entities(team_id,id,user_id,metadata,version,totp_key_id)
        SELECT $1,('71000000-0000-7000-8000-'||lpad(i::text,12,'0'))::uuid,$2,
        jsonb_set($3,'{id}',to_jsonb('71000000-0000-7000-8000-'||lpad(i::text,12,'0'))),1,
        CASE WHEN i=1001 THEN NULL ELSE ('72000000-0000-7000-8000-'||lpad(i::text,12,'0'))::uuid END
        FROM generate_series(1,1001) i"#,
        team.0,
        record.user_id.as_ref(),
        serde_json::to_value(&record.metadata).expect("metadata")
    )
    .execute(&repository.pool)
    .await
    .expect("active item fixtures");
    sqlx::query!("INSERT INTO password_totp_enrollments(team_id,item_id,key_id,state,cleanup_after) SELECT $1,('71000000-0000-7000-8000-'||lpad(i::text,12,'0'))::uuid,('72000000-0000-7000-8000-'||lpad(i::text,12,'0'))::uuid,'active',now()+interval '1 hour' FROM generate_series(1,1001) i",team.0)
        .execute(&repository.pool).await.expect("active journal fixtures");
    assert!(
        repository
            .totp_cleanup_due()
            .await
            .expect("first active page")
            .is_empty()
    );
    let cursor = sqlx::query!("SELECT key_id FROM password_totp_cleanup_cursor WHERE singleton")
        .fetch_one(&repository.pool)
        .await
        .expect("cursor");
    assert_eq!(
        cursor.key_id,
        Some(Uuid::parse_str("72000000-0000-7000-8000-000000001000").expect("fixture"))
    );
    sqlx::query!("INSERT INTO password_totp_enrollments(team_id,item_id,key_id,state,cleanup_after) SELECT $1,$2,('70000000-0000-7000-8000-'||lpad(i::text,12,'0'))::uuid,'pending',now()-interval '1 hour' FROM generate_series(1,100) i",team.0,record.metadata.id.0)
        .execute(&repository.pool).await.expect("fill fast batch");
    let batch = repository
        .totp_cleanup_due()
        .await
        .expect("orphan discovered behind full batch");
    assert_eq!(batch.len(), 100);
    let orphan_key =
        TotpKeyId(Uuid::parse_str("72000000-0000-7000-8000-000000001001").expect("fixture"));
    assert!(!batch.iter().any(|entry| entry.key_id == orphan_key));
    let pending = sqlx::query_scalar!(
        "SELECT count(*) FROM password_totp_cleanup_candidates WHERE team_id=$1 AND key_id=$2",
        team.0,
        orphan_key.0
    )
    .fetch_one(&repository.pool)
    .await
    .expect("durable candidate");
    assert_eq!(pending, Some(1));
    // A caller that cannot get the vault lease leaves discovery state intact.
    let lease = repository
        .lock(team, record.metadata.id)
        .await
        .expect("vault lease");
    assert!(matches!(
        repository.lock(team, record.metadata.id).await,
        Err(Error::Busy)
    ));
    repository
        .totp_cleanup_due()
        .await
        .expect("contended candidates retained");
    drop(lease);
    let orphan = TotpCleanup {
        team_id: team,
        item_id: ItemId(Uuid::parse_str("71000000-0000-7000-8000-000000001001").expect("fixture")),
        key_id: orphan_key,
    };
    assert!(
        !repository
            .totp_cleanup_ready(orphan)
            .await
            .expect("quarantine")
    );
    let state=sqlx::query!("SELECT state,cleanup_started_at FROM password_totp_enrollments WHERE team_id=$1 AND key_id=$2",team.0,orphan_key.0)
        .fetch_one(&repository.pool).await.expect("retired queue");
    assert_eq!(state.state, "retired");
    assert!(state.cleanup_started_at.is_some());
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM password_totp_cleanup_candidates WHERE team_id=$1 AND key_id=$2",
            team.0,
            orphan_key.0
        )
        .fetch_one(&repository.pool)
        .await
        .expect("candidate retired"),
        Some(0)
    );
    sqlx::query!("UPDATE password_totp_enrollments SET cleanup_retry_after=now()-interval '1 second',cleanup_after=now()-interval '1 minute' WHERE team_id=$1 AND key_id=$2",team.0,orphan_key.0)
        .execute(&repository.pool).await.expect("expire quarantine");
    assert!(
        repository
            .totp_cleanup_ready(orphan)
            .await
            .expect("ready retry")
    );
    // No finish acknowledgement simulates a provider failure: due state persists.
    assert!(
        repository
            .totp_cleanup_ready(orphan)
            .await
            .expect("failure retry")
    );
    repository
        .finish_totp_cleanup(orphan)
        .await
        .expect("acknowledge erasure");
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM password_totp_enrollments WHERE team_id=$1 AND key_id=$2",
            team.0,
            orphan_key.0
        )
        .fetch_one(&repository.pool)
        .await
        .expect("permanent identity"),
        Some(1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repair_insert_and_cursor_roll_back_together_on_database_failure(pool: PgPool) {
    let (repository, _, record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    let key = TotpKeyId(Uuid::now_v7());
    repository
        .stage_totp(team, record.metadata.id, key)
        .await
        .expect("stage");
    sqlx::query!(
        "UPDATE password_totp_enrollments SET state='active' WHERE team_id=$1 AND key_id=$2",
        team.0,
        key.0
    )
    .execute(&repository.pool)
    .await
    .expect("orphan fixture");
    sqlx::query!("CREATE FUNCTION reject_repair_cursor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic cursor failure'; END $$")
        .execute(&repository.pool).await.expect("fault injection function");
    sqlx::query!("CREATE TRIGGER reject_repair_cursor BEFORE UPDATE ON password_totp_cleanup_cursor FOR EACH ROW EXECUTE FUNCTION reject_repair_cursor()")
        .execute(&repository.pool).await.expect("fault injection trigger");
    assert!(matches!(
        repository.totp_cleanup_due().await,
        Err(Error::Unavailable)
    ));
    let row =
        sqlx::query!("SELECT team_id,key_id FROM password_totp_cleanup_cursor WHERE singleton")
            .fetch_one(&repository.pool)
            .await
            .expect("unchanged cursor");
    assert!(row.team_id.is_none());
    assert!(row.key_id.is_none());
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM password_totp_cleanup_candidates")
            .fetch_one(&repository.pool)
            .await
            .expect("rolled back queue"),
        Some(0)
    );
    sqlx::query!("DROP TRIGGER reject_repair_cursor ON password_totp_cleanup_cursor")
        .execute(&repository.pool)
        .await
        .expect("remove fault");
    let retry = repository
        .totp_cleanup_due()
        .await
        .expect("retry discovery");
    assert_eq!(retry.len(), 1);
    assert_eq!(retry[0].key_id, key);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replica_repairs_and_stale_candidates_keep_live_active_pointer_safe(pool: PgPool) {
    let (repository, _, record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    let key = TotpKeyId(Uuid::now_v7());
    repository
        .stage_totp(team, record.metadata.id, key)
        .await
        .expect("stage");
    repository
        .activate_totp(team, record.metadata.id, key, record.revision)
        .await
        .expect("activate");
    sqlx::query!(
        "INSERT INTO password_totp_cleanup_candidates(team_id,key_id) VALUES($1,$2)",
        team.0,
        key.0
    )
    .execute(&repository.pool)
    .await
    .expect("stale discovery");
    let (first, second) = tokio::join!(
        repository.discover_active_orphans(),
        repository.discover_active_orphans()
    );
    first.expect("replica one");
    second.expect("replica two");
    assert!(
        !repository
            .totp_cleanup_ready(TotpCleanup {
                team_id: team,
                item_id: record.metadata.id,
                key_id: key
            })
            .await
            .expect("live pointer excluded")
    );
    let state=sqlx::query!("SELECT state,cleanup_started_at FROM password_totp_enrollments WHERE team_id=$1 AND key_id=$2",team.0,key.0)
        .fetch_one(&repository.pool).await.expect("live journal");
    assert_eq!(state.state, "active");
    assert!(state.cleanup_started_at.is_none());
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM password_totp_cleanup_candidates")
            .fetch_one(&repository.pool)
            .await
            .expect("stale candidate removed"),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_or_busy_item_batch_does_not_starve_the_next_team(pool: PgPool) {
    let (repository, actor, record) = folder_fixture(pool).await;
    let bad = record.metadata.team_id;
    let (healthy, healthy_actor) = another_team(&repository.pool).await;
    sqlx::query!("INSERT INTO password_item_entities(team_id,id,user_id,metadata,version,deleting,cleanup_due_at) SELECT $1,('74000000-0000-7000-8000-'||lpad(i::text,12,'0'))::uuid,$2,'{}',1,true,now()-interval '2 hours' FROM generate_series(1,100) i",bad.0,actor.user_id.as_ref())
        .execute(&repository.pool).await.expect("bad item batch");
    let healthy_item = ItemId(Uuid::now_v7());
    sqlx::query!("INSERT INTO password_item_entities(team_id,id,user_id,metadata,version,deleting,cleanup_due_at) VALUES($1,$2,$3,'{}',1,true,now()-interval '1 hour')",healthy.0,healthy_item.0,healthy_actor.user_id.as_ref())
        .execute(&repository.pool).await.expect("healthy item");
    let lease = repository
        .lock(bad, record.metadata.id)
        .await
        .expect("busy bad namespace");
    let first = repository.item_cleanup_due().await.expect("first batch");
    assert_eq!(first.len(), 100);
    assert!(first.iter().all(|(team, _)| *team == bad));
    // No finish call represents either unavailable provider or failed lease admission.
    let next = repository.item_cleanup_due().await.expect("next pass");
    assert!(next.contains(&(healthy, healthy_item)));
    drop(lease);
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM password_item_entities WHERE team_id=$1 AND deleting AND deleted_at IS NULL",bad.0)
        .fetch_one(&repository.pool).await.expect("retry identities retained"),Some(100));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_totp_batches_rotate_without_shortening_quarantine_or_losing_candidates(
    pool: PgPool,
) {
    let (repository, _, record) = folder_fixture(pool).await;
    let bad = record.metadata.team_id;
    let (healthy, healthy_actor) = another_team(&repository.pool).await;
    let healthy_item = ItemId(Uuid::now_v7());
    sqlx::query!("INSERT INTO password_item_entities(team_id,id,user_id,metadata,version) VALUES($1,$2,$3,'{}',1)",healthy.0,healthy_item.0,healthy_actor.user_id.as_ref())
        .execute(&repository.pool).await.expect("healthy item");
    // Exercise all queue classes independently; the first 100 never acknowledge.
    for (state, started, erased, pending) in [
        ("pending", false, false, false),
        ("retired", true, false, false),
        ("retired", true, true, false),
        ("active", false, false, true),
    ] {
        sqlx::query!(
            "DELETE FROM password_totp_enrollments WHERE team_id=ANY($1)",
            &[bad.0, healthy.0]
        )
        .execute(&repository.pool)
        .await
        .expect("clear only this test's journals");
        sqlx::query!("INSERT INTO password_totp_enrollments(team_id,item_id,key_id,state,cleanup_after,cleanup_started_at,erased_at) SELECT $1,$2,('75000000-0000-7000-8000-'||lpad(i::text,12,'0'))::uuid,$3,now()-interval '2 hours',CASE WHEN $4 THEN now()-interval '1 day' ELSE NULL END,CASE WHEN $5 THEN now()-interval '1 day' ELSE NULL END FROM generate_series(1,100) i",bad.0,record.metadata.id.0,state,started,erased)
            .execute(&repository.pool).await.expect("bad queue class");
        let key = TotpKeyId(Uuid::now_v7());
        sqlx::query!("INSERT INTO password_totp_enrollments(team_id,item_id,key_id,state,cleanup_after,cleanup_started_at,erased_at) VALUES($1,$2,$3,$4,now()-interval '1 hour',CASE WHEN $5 THEN now()-interval '1 day' ELSE NULL END,CASE WHEN $6 THEN now()-interval '1 day' ELSE NULL END)",healthy.0,healthy_item.0,key.0,state,started,erased)
            .execute(&repository.pool).await.expect("healthy queue class");
        if pending {
            sqlx::query!("INSERT INTO password_totp_cleanup_candidates(team_id,key_id) SELECT team_id,key_id FROM password_totp_enrollments WHERE team_id=ANY($1)",&[bad.0,healthy.0])
                .execute(&repository.pool).await.expect("pending repair identities");
        }
        let deadlines=sqlx::query!("SELECT team_id,key_id,cleanup_after FROM password_totp_enrollments WHERE team_id=ANY($1) ORDER BY team_id,key_id",&[bad.0,healthy.0])
            .fetch_all(&repository.pool).await.expect("quarantine deadlines");
        let first = repository
            .totp_cleanup_due()
            .await
            .expect("first queue batch");
        assert_eq!(first.len(), 100);
        assert!(first.iter().all(|entry| entry.team_id == bad));
        let next = repository
            .totp_cleanup_due()
            .await
            .expect("next queue pass");
        assert!(
            next.iter()
                .any(|entry| entry.team_id == healthy && entry.key_id == key)
        );
        let retained=sqlx::query!("SELECT team_id,key_id,cleanup_after FROM password_totp_enrollments WHERE team_id=ANY($1) ORDER BY team_id,key_id",&[bad.0,healthy.0])
            .fetch_all(&repository.pool).await.expect("retained quarantine deadlines");
        assert_eq!(deadlines.len(), retained.len());
        for (before, after) in deadlines.iter().zip(retained.iter()) {
            assert_eq!(before.cleanup_after, after.cleanup_after);
        }
        if pending {
            assert_eq!(
                sqlx::query_scalar!(
                    "SELECT count(*) FROM password_totp_cleanup_candidates WHERE team_id=ANY($1)",
                    &[bad.0, healthy.0]
                )
                .fetch_one(&repository.pool)
                .await
                .expect("durable pending"),
                Some(101)
            );
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn old_failed_first_erasures_cannot_starve_new_quarantine_or_repair_work(pool: PgPool) {
    let (repository, _, record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    sqlx::query!("INSERT INTO password_totp_enrollments(team_id,item_id,key_id,state,cleanup_after,cleanup_started_at) SELECT $1,$2,('76000000-0000-7000-8000-'||lpad(i::text,12,'0'))::uuid,'retired',now()-interval '2 hours',now()-interval '1 day' FROM generate_series(1,300) i",team.0,record.metadata.id.0)
        .execute(&repository.pool).await.expect("three failing batches");
    assert_eq!(
        repository
            .totp_cleanup_due()
            .await
            .expect("first unavailable batch")
            .len(),
        100
    );
    assert_eq!(
        repository
            .totp_cleanup_due()
            .await
            .expect("second unavailable batch")
            .len(),
        100
    );
    let unstarted = TotpKeyId(Uuid::now_v7());
    let pending = TotpKeyId(Uuid::now_v7());
    repository
        .stage_totp(team, record.metadata.id, unstarted)
        .await
        .expect("new unstarted");
    repository
        .stage_totp(team, record.metadata.id, pending)
        .await
        .expect("new orphan repair");
    sqlx::query!(
        "UPDATE password_totp_enrollments SET state='active' WHERE team_id=$1 AND key_id=$2",
        team.0,
        pending.0
    )
    .execute(&repository.pool)
    .await
    .expect("orphan active");
    sqlx::query!(
        "INSERT INTO password_totp_cleanup_candidates(team_id,key_id) VALUES($1,$2)",
        team.0,
        pending.0
    )
    .execute(&repository.pool)
    .await
    .expect("durable pending repair");
    // Advance only retry clocks: no sleep, shortened quarantine or acknowledgement.
    sqlx::query!("UPDATE password_totp_enrollments SET cleanup_retry_after=now()-interval '1 second' WHERE team_id=$1 AND state='retired'",team.0)
        .execute(&repository.pool).await.expect("retry backoff elapsed");
    let batch = repository
        .totp_cleanup_due()
        .await
        .expect("cross-branch progress");
    assert!(batch.iter().any(|entry| entry.key_id == unstarted));
    assert!(batch.iter().any(|entry| entry.key_id == pending));
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM password_totp_enrollments WHERE team_id=$1 AND state='retired' AND cleanup_after<now()-interval '1 hour' AND erased_at IS NULL",team.0)
        .fetch_one(&repository.pool).await.expect("unacknowledged journals remain"),Some(300));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn item_claim_skips_a_locked_row_and_keeps_it_due_for_retry(pool: PgPool) {
    let (repository, _, record) = folder_fixture(pool).await;
    let team = record.metadata.team_id;
    let mut other = record.clone();
    other.metadata.id = ItemId(Uuid::now_v7());
    other.deleting = true;
    repository
        .save(&other, None)
        .await
        .expect("second tombstone");
    sqlx::query!("UPDATE password_item_entities SET deleting=true,cleanup_due_at=now()-interval '2 hours' WHERE team_id=$1 AND id=$2",team.0,record.metadata.id.0)
        .execute(&repository.pool).await.expect("older due item");
    sqlx::query!("UPDATE password_item_entities SET cleanup_due_at=now()-interval '1 hour' WHERE team_id=$1 AND id=$2",team.0,other.metadata.id.0)
        .execute(&repository.pool).await.expect("later due item");
    let mut held = repository.pool.begin().await.expect("row lock barrier");
    let before = sqlx::query!(
        "SELECT cleanup_due_at FROM password_item_entities WHERE team_id=$1 AND id=$2 FOR UPDATE",
        team.0,
        record.metadata.id.0
    )
    .fetch_one(&mut *held)
    .await
    .expect("hold first row");
    assert_eq!(
        repository
            .item_cleanup_due()
            .await
            .expect("skip locked claim"),
        vec![(team, other.metadata.id)]
    );
    let unchanged=sqlx::query!("SELECT cleanup_due_at,deleted_at,version FROM password_item_entities WHERE team_id=$1 AND id=$2",team.0,record.metadata.id.0)
        .fetch_one(&repository.pool).await.expect("unclaimed identity");
    assert_eq!(before.cleanup_due_at, unchanged.cleanup_due_at);
    assert!(unchanged.deleted_at.is_none());
    assert_eq!(unchanged.version, record.metadata.version);
    held.commit().await.expect("release row barrier");
    assert_eq!(
        repository
            .item_cleanup_due()
            .await
            .expect("retry unlocked row"),
        vec![(team, record.metadata.id)]
    );
}
