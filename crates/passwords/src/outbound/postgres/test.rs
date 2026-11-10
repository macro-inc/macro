use super::*;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn metadata_grants_intents_folders_and_deletion_are_team_isolated(pool: PgPool) {
    let first = TeamId(Uuid::now_v7());
    let second = TeamId(Uuid::now_v7());
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.test")
            .expect("fixture")
            .into_owned(),
        session_token: None,
    };
    let viewer = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|viewer@example.test")
            .expect("fixture")
            .into_owned(),
        session_token: None,
    };
    for (actor, team) in [(&owner, first), (&viewer, second)] {
        let email = actor
            .user_id
            .as_ref()
            .strip_prefix("macro|")
            .expect("fixture prefix");
        let macro_user_id = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO macro_user (id,username,email,stripe_customer_id) VALUES ($1,$2,$2,$3)",
            macro_user_id,
            email,
            format!("fixture-{macro_user_id}")
        )
        .execute(&pool)
        .await
        .expect("fixture account");
        sqlx::query!(
            r#"INSERT INTO "User" (id,email,macro_user_id) VALUES ($1,$2,$3)"#,
            actor.user_id.as_ref(),
            email,
            macro_user_id
        )
        .execute(&pool)
        .await
        .expect("fixture user");
        sqlx::query!(
            "INSERT INTO team(id,name,owner_id) VALUES ($1,'Fixture',$2)",
            team.0,
            actor.user_id.as_ref()
        )
        .execute(&pool)
        .await
        .expect("fixture team");
        sqlx::query!(
            "INSERT INTO team_user(user_id,team_id,team_role) VALUES ($1,$2,'owner')",
            actor.user_id.as_ref(),
            team.0
        )
        .execute(&pool)
        .await
        .expect("fixture membership");
    }
    let repository = PgRepository::new(pool).expect("repository capacity");
    assert_eq!(repository.teams(&owner).await.expect("teams"), vec![first]);
    assert_eq!(
        repository.teams(&viewer).await.expect("teams"),
        vec![second]
    );
    let folder = Folder {
        id: Uuid::now_v7(),
        team_id: first,
        name: "Operations".into(),
    };
    repository.save_folder(&folder).await.expect("folder");
    let now = Utc::now();
    let mut record = Record {
        user_id: owner.user_id.clone(),
        grants: vec![],
        deleting: false,
        member_removal_pending: false,
        totp_key_id: None,
        revision: 0,
        metadata: ItemMetadata {
            id: ItemId(Uuid::now_v7()),
            team_id: first,
            name: "Work login".into(),
            kind: ItemKind::Login,
            url: Some(
                LoginUrl::try_from("https://example.test/login".to_owned()).expect("fixture URL"),
            ),
            folder_id: Some(folder.id),
            favorite: false,
            version: 1,
            has_totp: false,
            shared: false,
            share_count: 0,
            created_at: now,
            updated_at: now,
            last_used_at: None,
        },
    };
    let operation = Uuid::now_v7();
    repository.stage(operation, &record).await.expect("stage");
    repository
        .stage(operation, &record)
        .await
        .expect("idempotent stage");
    assert_eq!(
        repository
            .staged(first, record.metadata.id, operation)
            .await
            .expect("intent")
            .metadata
            .name,
        "Work login"
    );
    assert!(matches!(
        repository
            .staged(second, record.metadata.id, operation)
            .await,
        Err(Error::NotFound)
    ));
    repository.save(&record, None).await.expect("create");
    record = repository
        .get(first, record.metadata.id)
        .await
        .expect("load created revision");
    repository
        .audit(first, record.metadata.id, &owner, Action::Create, operation)
        .await
        .expect("audit");
    repository
        .audit(first, record.metadata.id, &owner, Action::Create, operation)
        .await
        .expect("idempotent audit");
    let activity = repository
        .activity(first, record.metadata.id)
        .await
        .expect("activity");
    assert_eq!(activity.len(), 1);
    assert!(matches!(activity[0].action, Action::Create));
    assert!(
        repository
            .activity(second, record.metadata.id)
            .await
            .expect("isolated activity")
            .is_empty()
    );

    assert!(matches!(
        repository.save(&record, None).await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        repository.get(second, record.metadata.id).await,
        Err(Error::NotFound)
    ));
    assert_eq!(
        repository
            .list(&owner, first, "WORK")
            .await
            .expect("search")
            .len(),
        1
    );
    assert_eq!(
        repository
            .list(&owner, first, "example.test")
            .await
            .expect("URL search")
            .len(),
        1
    );
    assert!(
        repository
            .list(&owner, first, "absent")
            .await
            .expect("search")
            .is_empty()
    );
    assert!(
        repository
            .list(&viewer, first, "")
            .await
            .expect("hidden without grant")
            .is_empty()
    );
    record.grants = vec![Grant {
        kind: GranteeKind::User,
        id: viewer.user_id.to_string(),
        permission: Permission::View,
    }];
    record.metadata.shared = true;
    record.metadata.version = 2;
    repository.save(&record, Some(1)).await.expect("grant");
    assert!(matches!(
        repository.save(&record, Some(1)).await,
        Err(Error::Conflict)
    ));
    assert_eq!(
        repository
            .list(&viewer, first, "")
            .await
            .expect("user grant")
            .len(),
        1
    );
    record = repository
        .get(first, record.metadata.id)
        .await
        .expect("load granted revision");
    let stale_grant = record.clone();
    record.grants.clear();
    record.metadata.shared = false;
    repository
        .save(&record, Some(2))
        .await
        .expect("revoke grant at same secret version");
    assert!(matches!(
        repository.save(&stale_grant, Some(2)).await,
        Err(Error::Conflict)
    ));
    record = repository
        .get(first, record.metadata.id)
        .await
        .expect("revoked facts preserved");
    assert!(record.grants.is_empty());
    assert!(!record.metadata.shared);
    record.grants = vec![Grant {
        kind: GranteeKind::Team,
        id: second.0.to_string(),
        permission: Permission::View,
    }];
    record.metadata.version = 3;
    repository
        .save(&record, Some(2))
        .await
        .expect("foreign team grant");
    assert!(
        repository
            .list(&viewer, first, "")
            .await
            .expect("foreign grant hidden")
            .is_empty()
    );
    assert!(
        repository
            .folders(second)
            .await
            .expect("foreign folders")
            .is_empty()
    );
    repository
        .delete_folder(second, folder.id)
        .await
        .expect("foreign delete");
    assert_eq!(repository.folders(first).await.expect("folders").len(), 1);
    let stale_folder = repository
        .get(first, record.metadata.id)
        .await
        .expect("folder snapshot");
    repository
        .delete_folder(first, folder.id)
        .await
        .expect("delete folder");
    assert!(
        repository
            .get(first, record.metadata.id)
            .await
            .expect("record retained")
            .metadata
            .folder_id
            .is_none()
    );
    assert!(matches!(
        repository.save(&stale_folder, Some(3)).await,
        Err(Error::Conflict)
    ));
    let enrollment_revision = repository
        .get(first, record.metadata.id)
        .await
        .expect("enrollment revision")
        .revision;
    let first_key = TotpKeyId(Uuid::now_v7());
    let second_key = TotpKeyId(Uuid::now_v7());
    repository
        .stage_totp(first, record.metadata.id, first_key)
        .await
        .expect("pending enrollment");
    assert_eq!(
        repository
            .totp_cleanup_due()
            .await
            .expect("pending enrollment discovery")
            .len(),
        1
    );
    assert!(matches!(
        repository
            .activate_totp(second, record.metadata.id, first_key, enrollment_revision)
            .await,
        Err(Error::NotFound)
    ));
    repository
        .activate_totp(first, record.metadata.id, first_key, enrollment_revision)
        .await
        .expect("activate");
    assert_eq!(
        repository
            .get(first, record.metadata.id)
            .await
            .expect("active record")
            .totp_key_id,
        Some(first_key)
    );
    let replacement_revision = repository
        .get(first, record.metadata.id)
        .await
        .expect("replacement revision")
        .revision;
    repository
        .stage_totp(first, record.metadata.id, second_key)
        .await
        .expect("replacement intent");
    repository
        .activate_totp(first, record.metadata.id, second_key, replacement_revision)
        .await
        .expect("replace");
    let retiring = TotpCleanup {
        team_id: first,
        item_id: record.metadata.id,
        key_id: first_key,
    };
    assert!(
        !repository
            .totp_cleanup_ready(retiring)
            .await
            .expect("start retirement quarantine")
    );
    sqlx::query!("UPDATE password_totp_enrollments SET cleanup_after=now()-interval '1 second' WHERE team_id=$1",first.0).execute(&repository.pool).await.expect("expire synthetic enrollment");
    let due = repository
        .totp_cleanup_due()
        .await
        .expect("retired enrollments");
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].key_id, first_key);
    assert!(
        repository
            .totp_cleanup_ready(due[0])
            .await
            .expect("retired ready")
    );
    assert!(
        !repository
            .totp_cleanup_ready(TotpCleanup {
                team_id: first,
                item_id: record.metadata.id,
                key_id: second_key
            })
            .await
            .expect("active protected")
    );
    assert!(
        !repository
            .totp_cleanup_ready(TotpCleanup {
                team_id: second,
                item_id: record.metadata.id,
                key_id: first_key
            })
            .await
            .expect("cross-team cleanup denied")
    );
    repository
        .finish_totp_cleanup(due[0])
        .await
        .expect("finish retired cleanup");
    let keys = repository
        .totp_keys(first, record.metadata.id)
        .await
        .expect("active and retired identities retained");
    assert_eq!(keys.len(), 2);
    assert!(keys.contains(&first_key));
    assert!(keys.contains(&second_key));
    let stale_totp = repository
        .get(first, record.metadata.id)
        .await
        .expect("active TOTP snapshot");
    repository
        .retire_totp(first, record.metadata.id, Some(stale_totp.revision))
        .await
        .expect("retire active");
    let retired = repository
        .get(first, record.metadata.id)
        .await
        .expect("retired record");
    assert!(matches!(
        repository.save(&stale_totp, Some(3)).await,
        Err(Error::Conflict)
    ));
    assert!(
        repository
            .get(first, record.metadata.id)
            .await
            .expect("TOTP retirement preserved")
            .totp_key_id
            .is_none()
    );
    assert!(retired.totp_key_id.is_none());
    assert!(!retired.metadata.has_totp);
    let retiring = TotpCleanup {
        team_id: first,
        item_id: record.metadata.id,
        key_id: second_key,
    };
    assert!(
        !repository
            .totp_cleanup_ready(retiring)
            .await
            .expect("start retirement quarantine")
    );
    assert!(
        repository
            .totp_cleanup_due()
            .await
            .expect("fresh retirement grace")
            .is_empty()
    );
    sqlx::query!("UPDATE password_totp_enrollments SET cleanup_after=now()-interval '1 second' WHERE team_id=$1 AND key_id=$2",first.0,second_key.0).execute(&repository.pool).await.expect("expire synthetic retirement");
    let due = repository
        .totp_cleanup_due()
        .await
        .expect("retired cleanup");
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].key_id, second_key);
    assert!(
        repository
            .totp_cleanup_ready(due[0])
            .await
            .expect("quarantine grace elapsed")
    );
    repository
        .finish_totp_cleanup(due[0])
        .await
        .expect("cleanup");
    assert_eq!(
        repository
            .totp_keys(first, record.metadata.id)
            .await
            .expect("retired cleanup identities retained")
            .len(),
        2
    );
    assert!(
        repository
            .totp_cleanup_due()
            .await
            .expect("hourly retry deferred")
            .is_empty()
    );
    let canceled_key = TotpKeyId(Uuid::now_v7());
    repository
        .stage_totp(first, record.metadata.id, canceled_key)
        .await
        .expect("canceled pending enrollment");
    let canceled = TotpCleanup {
        team_id: first,
        item_id: record.metadata.id,
        key_id: canceled_key,
    };
    assert!(
        !repository
            .totp_cleanup_ready(canceled)
            .await
            .expect("quarantine canceled setup")
    );
    let canceled_revision = repository
        .get(first, record.metadata.id)
        .await
        .expect("canceled enrollment revision")
        .revision;
    assert!(matches!(
        repository
            .activate_totp(first, record.metadata.id, canceled_key, canceled_revision)
            .await,
        Err(Error::Conflict)
    ));
    sqlx::query!("UPDATE password_totp_enrollments SET cleanup_after=now()-interval '1 second' WHERE team_id=$1 AND key_id=$2",first.0,canceled_key.0).execute(&repository.pool).await.expect("expire canceled setup quarantine");
    assert!(
        repository
            .totp_cleanup_ready(canceled)
            .await
            .expect("canceled quarantine elapsed")
    );
    repository
        .finish_totp_cleanup(canceled)
        .await
        .expect("canceled cleanup");
    assert_eq!(
        repository
            .totp_keys(first, record.metadata.id)
            .await
            .expect("permanent cleanup identities")
            .len(),
        3
    );
    assert!(
        repository
            .totp_cleanup_due()
            .await
            .expect("hourly retry deferred")
            .is_empty()
    );
    repository.finish(operation).await.expect("finish");
    assert_eq!(
        repository
            .staged(first, record.metadata.id, operation)
            .await
            .expect("completed journal")
            .metadata
            .version,
        1
    );
    assert!(matches!(
        repository.stage(operation, &record).await,
        Err(Error::Conflict)
    ));
    let stale_deleting = repository
        .get(first, record.metadata.id)
        .await
        .expect("pre-deletion snapshot");
    let mut deleting = stale_deleting.clone();
    deleting.deleting = true;
    repository
        .save(&deleting, Some(3))
        .await
        .expect("deletion fence");
    assert!(matches!(
        repository.save(&stale_deleting, Some(3)).await,
        Err(Error::Conflict)
    ));
    assert!(
        repository
            .get(first, record.metadata.id)
            .await
            .expect("deletion fence preserved")
            .deleting
    );
    repository
        .delete(first, record.metadata.id)
        .await
        .expect("delete");
    assert!(
        repository
            .get(first, record.metadata.id)
            .await
            .expect("deletion tombstone facts")
            .deleting
    );
    assert!(
        repository
            .list(&owner, first, "")
            .await
            .expect("list")
            .is_empty()
    );
    assert!(matches!(
        repository.save(&record, None).await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        repository.save(&record, Some(3)).await,
        Err(Error::Conflict)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn contended_team_lock_returns_busy_without_holding_a_waiting_connection(pool: PgPool) {
    let repository = PgRepository::new(pool).expect("repository capacity");
    let team = TeamId(Uuid::now_v7());
    let first = repository
        .lock(team, ItemId(Uuid::now_v7()))
        .await
        .expect("first lease");
    assert!(matches!(
        repository.lock(team, ItemId(Uuid::now_v7())).await,
        Err(Error::Busy)
    ));
    let different_team = repository
        .lock(TeamId(Uuid::now_v7()), ItemId(Uuid::now_v7()))
        .await
        .expect("independent team lease");
    drop(different_team);
    drop(first);
    // Acquire all connections so each queued rollback completes before checking release.
    let connection_count = repository.pool.size();
    let mut connections = Vec::new();
    for _ in 0..connection_count {
        connections.push(repository.pool.acquire().await.expect("drain rollback"));
    }
    drop(connections);
    let _lease = repository
        .lock(team, ItemId(Uuid::now_v7()))
        .await
        .expect("released lease");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn distinct_team_leases_share_admission_and_reserve_database_query_capacity(pool: PgPool) {
    let bounded_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(4)
        .connect_with(pool.connect_options().as_ref().clone())
        .await
        .expect("bounded pool");
    let repository =
        Arc::new(PgRepository::new(bounded_pool.clone()).expect("repository capacity"));
    let shared_repository = repository.clone();
    let first = repository
        .lock(TeamId(Uuid::now_v7()), ItemId(Uuid::now_v7()))
        .await
        .expect("first distinct-team lease");
    let second = shared_repository
        .lock(TeamId(Uuid::now_v7()), ItemId(Uuid::now_v7()))
        .await
        .expect("second distinct-team lease");
    assert!(matches!(
        repository
            .lock(TeamId(Uuid::now_v7()), ItemId(Uuid::now_v7()))
            .await,
        Err(Error::Busy)
    ));
    let query = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        sqlx::query!("SELECT 1 AS present").fetch_one(&bounded_pool),
    )
    .await
    .expect("queries retain connection capacity")
    .expect("query");
    assert_eq!(query.present, Some(1));
    drop(first);
    let replacement = repository
        .lock(TeamId(Uuid::now_v7()), ItemId(Uuid::now_v7()))
        .await
        .expect("released admission permit");
    assert!(matches!(
        shared_repository
            .lock(TeamId(Uuid::now_v7()), ItemId(Uuid::now_v7()))
            .await,
        Err(Error::Busy)
    ));
    drop(second);
    drop(replacement);
    let too_small = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy("postgres://user:password@127.0.0.1:15442/macrodb")
        .expect("fixture URL");
    assert!(matches!(PgRepository::new(too_small), Err(Error::Invalid)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_totp_setup_and_removal_cannot_override_a_newer_enrollment_or_removal(pool: PgPool) {
    let team = TeamId(Uuid::now_v7());
    let item = ItemId(Uuid::now_v7());
    let owner = MacroUserIdStr::parse_from_str("macro|revision@example.test")
        .expect("identity")
        .into_owned();
    let macro_user_id = Uuid::now_v7();
    sqlx::query!("INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES($1,'revision@example.test','revision@example.test',$2)",macro_user_id,format!("fixture-{macro_user_id}")).execute(&pool).await.expect("account");
    sqlx::query!(
        r#"INSERT INTO "User"(id,email,macro_user_id) VALUES($1,'revision@example.test',$2)"#,
        owner.as_ref(),
        macro_user_id
    )
    .execute(&pool)
    .await
    .expect("user");
    sqlx::query!(
        "INSERT INTO team(id,name,owner_id) VALUES($1,'Fixture',$2)",
        team.0,
        owner.as_ref()
    )
    .execute(&pool)
    .await
    .expect("team");
    let repository = PgRepository::new(pool).expect("repository capacity");
    let now = Utc::now();
    repository
        .save(
            &Record {
                user_id: owner,
                grants: vec![],
                deleting: false,
                member_removal_pending: false,
                revision: 0,
                totp_key_id: None,
                metadata: ItemMetadata {
                    id: item,
                    team_id: team,
                    name: "Synthetic login".into(),
                    kind: ItemKind::Login,
                    url: None,
                    folder_id: None,
                    favorite: false,
                    version: 1,
                    has_totp: false,
                    shared: false,
                    share_count: 0,
                    created_at: now,
                    updated_at: now,
                    last_used_at: None,
                },
            },
            None,
        )
        .await
        .expect("metadata");
    let observed = repository.get(team, item).await.expect("setup snapshot");
    let old_key = TotpKeyId(Uuid::now_v7());
    let new_key = TotpKeyId(Uuid::now_v7());
    repository
        .stage_totp(team, item, old_key)
        .await
        .expect("old setup pending at provider");
    repository
        .stage_totp(team, item, new_key)
        .await
        .expect("newer setup");
    repository
        .activate_totp(team, item, new_key, observed.revision)
        .await
        .expect("newer setup commits first");
    assert!(matches!(
        repository
            .activate_totp(team, item, old_key, observed.revision)
            .await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        repository
            .retire_totp(team, item, Some(observed.revision))
            .await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        repository.retire_totp(team, item, None).await,
        Err(Error::Conflict)
    ));
    let active = repository
        .get(team, item)
        .await
        .expect("new active enrollment preserved");
    assert_eq!(active.totp_key_id, Some(new_key));
    assert!(active.metadata.has_totp);
    let new_state = sqlx::query!(
        "SELECT state FROM password_totp_enrollments WHERE team_id=$1 AND key_id=$2",
        team.0,
        new_key.0
    )
    .fetch_one(&repository.pool)
    .await
    .expect("active provider enrollment journal");
    assert_eq!(new_state.state, "active");
    repository
        .retire_totp(team, item, Some(active.revision))
        .await
        .expect("current removal");
    let resumed_key = TotpKeyId(Uuid::now_v7());
    // The old setup can resume before staging after a newer remove already completed.
    repository
        .stage_totp(team, item, resumed_key)
        .await
        .expect("late setup intent");
    assert!(matches!(
        repository
            .activate_totp(team, item, resumed_key, active.revision)
            .await,
        Err(Error::Conflict)
    ));
    let removed = repository.get(team, item).await.expect("removal preserved");
    assert!(removed.totp_key_id.is_none());
    assert!(!removed.metadata.has_totp);
    assert!(removed.revision > active.revision);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn first_erasure_and_quarantine_are_not_starved_by_repeat_tombstones(pool: PgPool) {
    let team = TeamId(Uuid::now_v7());
    let item = ItemId(Uuid::now_v7());
    let account = Uuid::now_v7();
    sqlx::query!("INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES($1,'queue@example.test','queue@example.test',$2)", account, format!("fixture-{account}"))
        .execute(&pool).await.expect("account");
    sqlx::query!(r#"INSERT INTO "User"(id,email,macro_user_id) VALUES('macro|queue@example.test','queue@example.test',$1)"#, account)
        .execute(&pool).await.expect("user");
    sqlx::query!(
        "INSERT INTO team(id,name,owner_id) VALUES($1,'Fixture','macro|queue@example.test')",
        team.0
    )
    .execute(&pool)
    .await
    .expect("team");
    sqlx::query!("INSERT INTO password_item_entities(team_id,id,user_id,metadata,version) VALUES($1,$2,'macro|queue@example.test','{}',1)", team.0,item.0)
        .execute(&pool).await.expect("item");
    let repository = PgRepository::new(pool).expect("repository");
    for _ in 0..100 {
        let key_id = TotpKeyId(Uuid::now_v7());
        repository
            .stage_totp(team, item, key_id)
            .await
            .expect("repeat fixture");
        repository
            .finish_totp_cleanup(TotpCleanup {
                team_id: team,
                item_id: item,
                key_id,
            })
            .await
            .expect("acknowledged erasure");
    }
    sqlx::query!("UPDATE password_totp_enrollments SET cleanup_after=now()-interval '1 hour' WHERE team_id=$1", team.0)
        .execute(&repository.pool).await.expect("repeat erasures due");
    let first_erasure = TotpKeyId(Uuid::now_v7());
    repository
        .stage_totp(team, item, first_erasure)
        .await
        .expect("first erasure");
    assert!(
        repository
            .totp_cleanup_due()
            .await
            .expect("batch")
            .iter()
            .any(|entry| entry.key_id == first_erasure)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM password_totp_enrollments WHERE team_id=$1",
            team.0
        )
        .fetch_one(&repository.pool)
        .await
        .expect("retained tombstones"),
        Some(101)
    );
}
