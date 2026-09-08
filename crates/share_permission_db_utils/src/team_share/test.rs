use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_permissions::share_permission::team_share::{TeamShareRequest, authorize_team_share};
use sqlx::PgPool;

async fn nested_projects(tx: &mut Transaction<'_, Postgres>) -> rootcause::Result<()> {
    acquire_guard(tx).await?;
    sqlx::query!(r#"INSERT INTO "Project" (id, name, "userId", "parentId") VALUES ('20000000-0000-0000-0000-000000000007', 'Child', 'macro|owner@example.com', '20000000-0000-0000-0000-000000000001')"#).execute(tx.as_mut()).await?;
    sqlx::query!(r#"INSERT INTO "SharePermission" (id) VALUES ('child')"#)
        .execute(tx.as_mut())
        .await?;
    sqlx::query!(r#"INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId") VALUES ('20000000-0000-0000-0000-000000000007', 'child')"#).execute(tx.as_mut()).await?;
    sqlx::query!(r#"UPDATE "Document" SET "projectId" = '20000000-0000-0000-0000-000000000007'"#)
        .execute(tx.as_mut())
        .await?;
    sqlx::query!(r#"UPDATE "Chat" SET "projectId" = '20000000-0000-0000-0000-000000000007'"#)
        .execute(tx.as_mut())
        .await?;
    sqlx::query!("UPDATE email_threads SET project_id = '20000000-0000-0000-0000-000000000007'")
        .execute(tx.as_mut())
        .await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn canonical_project_shares_preserve_independent_contributions(
    pool: PgPool,
) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    nested_projects(&mut tx).await?;
    for (kind, index, level) in [
        (EntityType::Project, 7, AccessLevel::Comment),
        (EntityType::Document, 2, AccessLevel::Edit),
    ] {
        let facts = load_facts(&mut tx, &entity(kind, index)).await?;
        apply(&mut tx, &command(&facts, Some(level))).await?;
    }
    let root = entity(EntityType::Project, 1);
    for level in [
        Some(AccessLevel::Edit),
        Some(AccessLevel::View),
        Some(AccessLevel::View),
        None,
        None,
    ] {
        let facts = load_facts(&mut tx, &root).await?;
        apply(&mut tx, &command(&facts, level)).await?;
        let rows = sqlx::query!("SELECT access_level AS \"level: AccessLevel\", entity_type FROM entity_access WHERE granted_from_project_id = $1", root.entity_id.as_ref()).fetch_all(tx.as_mut()).await?;
        assert_eq!(rows.len(), if level.is_some() { 4 } else { 0 });
        assert!(
            rows.iter()
                .all(|r| Some(r.level) == level && r.entity_type != "call")
        );
        assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM entity_access WHERE granted_from_project_id = '20000000-0000-0000-0000-000000000007' AND access_level = 'comment'").fetch_one(tx.as_mut()).await?, Some(3));
        assert_eq!(
            load_facts(&mut tx, &entity(EntityType::Document, 2))
                .await?
                .current
                .unwrap()
                .level,
            TeamShareLevel::Edit
        );
    }
    tx.commit().await?;
    let mut tx = pool.begin().await?;
    assert_eq!(load_facts(&mut tx, &root).await?.current, None);
    assert_eq!(load_facts(&mut tx, &root).await?.revision, 5);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn inherited_write_failure_rolls_back_canonical_root(pool: PgPool) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    nested_projects(&mut tx).await?;
    tx.commit().await?;
    sqlx::raw_sql("CREATE FUNCTION reject_inherited() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.granted_from_project_id IS NOT NULL THEN RAISE EXCEPTION 'injected inherited failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_inherited BEFORE INSERT ON entity_access FOR EACH ROW EXECUTE FUNCTION reject_inherited();").execute(&pool).await?;
    let mut tx = pool.begin().await?;
    let root = entity(EntityType::Project, 1);
    let facts = load_facts(&mut tx, &root).await?;
    assert!(
        apply(&mut tx, &command(&facts, Some(AccessLevel::View)))
            .await
            .is_err()
    );
    tx.rollback().await?;
    let mut tx = pool.begin().await?;
    assert_eq!(load_facts(&mut tx, &root).await?, facts);
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM entity_access")
            .fetch_one(tx.as_mut())
            .await?,
        Some(0)
    );
    Ok(())
}

async fn move_child_out(tx: &mut Transaction<'_, Postgres>) -> rootcause::Result<()> {
    acquire_guard(tx).await?;
    let child = entity(EntityType::Project, 7);
    sqlx::query!(
        r#"UPDATE "Project" SET "parentId" = NULL WHERE id = $1"#,
        child.entity_id.as_ref()
    )
    .execute(tx.as_mut())
    .await?;
    entity_access_db_utils::project_inheritance::synchronize_entity(
        tx,
        &Uuid::parse_str(&child.entity_id)?,
        EntityType::Project,
    )
    .await?;
    Ok(())
}

async fn share_versus_move(pool: PgPool, share_first: bool, revoke: bool) -> rootcause::Result<()> {
    let root = entity(EntityType::Project, 1);
    let mut setup = pool.begin().await?;
    nested_projects(&mut setup).await?;
    if revoke {
        let facts = load_facts(&mut setup, &root).await?;
        apply(&mut setup, &command(&facts, Some(AccessLevel::Edit))).await?;
    }
    let facts = load_facts(&mut setup, &root).await?;
    let mutation = command(
        &facts,
        if revoke {
            None
        } else {
            Some(AccessLevel::View)
        },
    );
    setup.commit().await?;

    let mut first = pool.begin().await?;
    acquire_guard(&mut first).await?;
    if share_first {
        apply(&mut first, &mutation).await?;
    } else {
        move_child_out(&mut first).await?;
    }
    let other_pool = pool.clone();
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let other_barrier = barrier.clone();
    let contender = tokio::spawn(async move {
        let mut second = other_pool.begin().await?;
        other_barrier.wait().await;
        if share_first {
            move_child_out(&mut second).await?;
        } else {
            apply(&mut second, &mutation).await?;
        }
        second.commit().await?;
        Ok::<_, rootcause::Report>(())
    });
    barrier.wait().await;
    // Observe the actual lock wait, rather than relying on task scheduling or sleeps.
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting = sqlx::query_scalar!("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database()))").fetch_one(first.as_mut()).await?;
            if waiting == Some(true) { break; }
            tokio::task::yield_now().await;
        }
        Ok::<_, sqlx::Error>(())
    }).await??;
    assert!(!contender.is_finished());
    first.commit().await?;
    contender.await??;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM entity_access WHERE granted_from_project_id = $1",
            root.entity_id.as_ref()
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    let mut tx = pool.begin().await?;
    let final_state = load_facts(&mut tx, &root).await?;
    assert_eq!(
        final_state.current.map(|g| g.level),
        if revoke {
            None
        } else {
            Some(TeamShareLevel::View)
        }
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn share_then_parent_change(pool: PgPool) -> rootcause::Result<()> {
    share_versus_move(pool, true, false).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn parent_change_then_share(pool: PgPool) -> rootcause::Result<()> {
    share_versus_move(pool, false, false).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn revoke_then_parent_change(pool: PgPool) -> rootcause::Result<()> {
    share_versus_move(pool, true, true).await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn parent_change_then_revoke(pool: PgPool) -> rootcause::Result<()> {
    share_versus_move(pool, false, true).await
}

fn entity(kind: EntityType, index: u8) -> Entity<'static> {
    kind.with_entity_string(format!("20000000-0000-0000-0000-{index:012}"))
}

fn command(facts: &TeamShareFacts, level: Option<AccessLevel>) -> AuthorizedTeamShareCommand {
    authorize_team_share(
        Some(&facts.owner),
        facts,
        TeamShareRequest {
            access_level: Some(level),
            legacy_enabled: None,
        },
        TeamShareLevel::View,
    )
    .unwrap()
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn authoritative_facts_for_every_kind(pool: PgPool) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    for (kind, index) in [
        (EntityType::Project, 1),
        (EntityType::Document, 2),
        (EntityType::Chat, 3),
        (EntityType::EmailThread, 4),
        (EntityType::Call, 5),
        (EntityType::Call, 6),
    ] {
        let facts = load_facts(&mut tx, &entity(kind, index)).await?;
        assert_eq!(facts.owner.as_ref(), "macro|owner@example.com");
        assert!(facts.owner_team_id.is_some());
        assert_eq!(facts.current, None);
        assert_eq!(facts.revision, 0);
    }
    let missing = load_facts(&mut tx, &entity(EntityType::Document, 99))
        .await
        .unwrap_err();
    assert_eq!(*missing.current_context(), TeamShareError::NotFound);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn exact_levels_revisions_and_caller_rollback(pool: PgPool) -> rootcause::Result<()> {
    let document = entity(EntityType::Document, 2);
    let mut tx = pool.begin().await?;
    let initial = load_facts(&mut tx, &document).await?;
    assert!(
        authorize_team_share(
            None,
            &initial,
            TeamShareRequest::default(),
            TeamShareLevel::View
        )?
        .is_none()
    );
    assert_eq!(load_facts(&mut tx, &document).await?, initial);
    for (index, level) in [
        Some(AccessLevel::Edit),
        Some(AccessLevel::View),
        Some(AccessLevel::View),
        None,
        None,
    ]
    .into_iter()
    .enumerate()
    {
        let facts = load_facts(&mut tx, &document).await?;
        apply(&mut tx, &command(&facts, level)).await?;
        let updated = load_facts(&mut tx, &document).await?;
        assert_eq!(updated.revision, index as i64 + 1);
        assert_eq!(updated.current.map(|g| AccessLevel::from(g.level)), level);
        let grant = entity_access_db_utils::team_share::direct_level(
            tx.as_mut(),
            &Uuid::parse_str(&document.entity_id)?,
            document.entity_type,
            initial.owner_team_id.unwrap(),
        )
        .await?;
        assert_eq!(grant, level);
    }
    tx.rollback().await?;
    let mut tx = pool.begin().await?;
    assert_eq!(load_facts(&mut tx, &document).await?, initial);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn stale_facts_and_untracked_grants_are_conflicts(pool: PgPool) -> rootcause::Result<()> {
    let document = entity(EntityType::Document, 2);
    let mut tx = pool.begin().await?;
    let facts = load_facts(&mut tx, &document).await?;
    let set = command(&facts, Some(AccessLevel::View));
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'document', $2, 'team', 'view')", Uuid::parse_str(&document.entity_id)?, facts.owner_team_id.unwrap().to_string()).execute(tx.as_mut()).await?;
    assert_eq!(
        *apply(&mut tx, &set).await.unwrap_err().current_context(),
        TeamShareError::UntrackedGrant
    );
    assert_eq!(load_facts(&mut tx, &document).await?, facts);
    apply(&mut tx, &command(&facts, None)).await?;
    assert_eq!(
        *apply(&mut tx, &set).await.unwrap_err().current_context(),
        TeamShareError::ChangedFacts
    );
    let facts = load_facts(&mut tx, &document).await?;
    adopt(
        &mut tx,
        &facts,
        TeamShareGrant {
            team_id: facts.owner_team_id.unwrap(),
            level: TeamShareLevel::View,
        },
    )
    .await?;
    assert_eq!(load_facts(&mut tx, &document).await?.revision, 2);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn clear_uses_managed_team_and_preserves_other_grants(pool: PgPool) -> rootcause::Result<()> {
    let document = entity(EntityType::Document, 2);
    let mut tx = pool.begin().await?;
    let facts = load_facts(&mut tx, &document).await?;
    apply(&mut tx, &command(&facts, Some(AccessLevel::Comment))).await?;
    sqlx::query!("DELETE FROM team_user WHERE user_id = 'macro|owner@example.com'")
        .execute(tx.as_mut())
        .await?;
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) VALUES ($1, 'document', $2, 'team', 'edit', '20000000-0000-0000-0000-000000000001'), ($1, 'document', 'unexplained', 'team', 'view', NULL)", Uuid::parse_str(&document.entity_id)?, facts.owner_team_id.unwrap().to_string()).execute(tx.as_mut()).await?;
    let facts = load_facts(&mut tx, &document).await?;
    assert_eq!(facts.owner_team_id, None);
    let snapshot = cleanup_snapshot(&facts).unwrap();
    assert_eq!(snapshot.root, document);
    assert_eq!(snapshot.revision, 1);
    maintain(&mut tx, &TeamShareMaintenance::Clear { expected: facts }).await?;
    let remaining = sqlx::query_scalar!(
        "SELECT count(*) FROM entity_access WHERE entity_id = $1",
        Uuid::parse_str(&document.entity_id)?
    )
    .fetch_one(tx.as_mut())
    .await?;
    assert_eq!(remaining, Some(2));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn failed_grant_rolls_back_state_and_revision(pool: PgPool) -> rootcause::Result<()> {
    // A database-side failure after authorization must roll back the entire operation.
    sqlx::raw_sql("CREATE FUNCTION reject_team_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected grant failure'; END $$; CREATE TRIGGER reject_team_grant BEFORE INSERT ON entity_access FOR EACH ROW EXECUTE FUNCTION reject_team_grant();").execute(&pool).await?;
    let document = entity(EntityType::Document, 2);
    let mut tx = pool.begin().await?;
    let facts = load_facts(&mut tx, &document).await?;
    let error = apply(&mut tx, &command(&facts, Some(AccessLevel::Edit)))
        .await
        .unwrap_err();
    assert_eq!(*error.current_context(), TeamShareError::Infrastructure);
    tx.rollback().await?;
    let mut tx = pool.begin().await?;
    assert_eq!(load_facts(&mut tx, &document).await?, facts);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn concurrent_lazy_thread_creation_is_unique(pool: PgPool) -> rootcause::Result<()> {
    let thread = entity(EntityType::EmailThread, 4);
    let mut tx = pool.begin().await?;
    let id = ensure_thread_share_permission_in_transaction(&mut tx, &thread.entity_id).await?;
    let other_pool = pool.clone();
    let thread_id = thread.entity_id.to_string();
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let contender_barrier = barrier.clone();
    let contender = tokio::spawn(async move {
        contender_barrier.wait().await;
        crate::ensure_thread_share_permission(&other_pool, &thread_id).await
    });
    // Both callers are running while the first still owns the transaction guard.
    barrier.wait().await;
    assert!(!contender.is_finished());
    tx.commit().await?;
    contender.await?.into_rootcause()?;
    let mut tx = pool.begin().await?;
    assert_eq!(
        ensure_thread_share_permission_in_transaction(&mut tx, &thread.entity_id).await?,
        id
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM \"EmailThreadPermission\"")
            .fetch_one(tx.as_mut())
            .await?,
        Some(1)
    );
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM entity_access WHERE entity_type = 'email_thread' AND source_type = 'user' AND access_level = 'owner'").fetch_one(tx.as_mut()).await?, Some(1));
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM \"SharePermission\"")
            .fetch_one(tx.as_mut())
            .await?,
        Some(6)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn guarded_writer_rechecks_after_another_transaction_commits(
    pool: PgPool,
) -> rootcause::Result<()> {
    let document = entity(EntityType::Document, 2);
    let mut reader = pool.begin().await?;
    let original = load_facts(&mut reader, &document).await?;
    let stale = command(&original, Some(AccessLevel::Edit));
    reader.commit().await?;

    let mut first = pool.begin().await?;
    apply(&mut first, &command(&original, Some(AccessLevel::View))).await?;
    let other_pool = pool.clone();
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let contender_barrier = barrier.clone();
    let contender = tokio::spawn(async move {
        let mut transaction = other_pool
            .begin()
            .await
            .context(TeamShareError::Infrastructure)?;
        contender_barrier.wait().await;
        let result = apply(&mut transaction, &stale).await;
        transaction
            .rollback()
            .await
            .context(TeamShareError::Infrastructure)?;
        result
    });
    barrier.wait().await;
    assert!(!contender.is_finished());
    first.commit().await?;
    assert_eq!(
        *contender.await?.unwrap_err().current_context(),
        TeamShareError::ChangedFacts
    );
    let mut reader = pool.begin().await?;
    let final_state = load_facts(&mut reader, &document).await?;
    assert_eq!(final_state.revision, 1);
    assert_eq!(final_state.current.unwrap().level, TeamShareLevel::View);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn schema_enforces_canonical_pairs_and_revisions(pool: PgPool) -> rootcause::Result<()> {
    for (level, team, revision, valid) in [
        (None, None, 0, true),
        (Some(AccessLevel::View), Some(Uuid::nil()), 1, true),
        (Some(AccessLevel::Comment), Some(Uuid::nil()), 2, true),
        (Some(AccessLevel::Edit), Some(Uuid::nil()), 3, true),
        (Some(AccessLevel::Owner), Some(Uuid::nil()), 0, false),
        (Some(AccessLevel::View), None, 0, false),
        (None, Some(Uuid::nil()), 0, false),
        (None, None, -1, false),
    ] {
        let mut tx = pool.begin().await?;
        let result = sqlx::query!("INSERT INTO \"SharePermission\" (team_share_access_level, team_share_team_id, team_share_revision) VALUES ($1, $2, $3)", level as Option<AccessLevel>, team, revision).execute(tx.as_mut()).await;
        assert_eq!(result.is_ok(), valid);
        tx.rollback().await?;
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn every_authorized_fact_is_rechecked(pool: PgPool) -> rootcause::Result<()> {
    let document = entity(EntityType::Document, 2);
    for changed in 0..4 {
        let mut tx = pool.begin().await?;
        let facts = load_facts(&mut tx, &document).await?;
        let set = command(&facts, Some(AccessLevel::View));
        match changed {
            0 => {
                sqlx::query!(r#"UPDATE "Document" SET owner = 'macro|other@example.com'"#)
                    .execute(tx.as_mut())
                    .await?;
            }
            1 => {
                sqlx::query!("DELETE FROM team_user")
                    .execute(tx.as_mut())
                    .await?;
            }
            2 => {
                sqlx::query!(
                    r#"UPDATE "SharePermission" SET team_share_revision = 1 WHERE id = 'document'"#
                )
                .execute(tx.as_mut())
                .await?;
            }
            _ => {
                sqlx::query!(r#"UPDATE "SharePermission" SET team_share_access_level = 'comment', team_share_team_id = $1 WHERE id = 'document'"#, facts.owner_team_id).execute(tx.as_mut()).await?;
            }
        }
        assert_eq!(
            *apply(&mut tx, &set).await.unwrap_err().current_context(),
            TeamShareError::ChangedFacts
        );
        tx.rollback().await?;
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn lazy_thread_clear_and_owner_grants_are_atomic(pool: PgPool) -> rootcause::Result<()> {
    let thread = entity(EntityType::EmailThread, 4);
    let mut tx = pool.begin().await?;
    let initial = load_facts(&mut tx, &thread).await?;
    // An unexplained user grant must not be upgraded incidentally.
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'email_thread', 'macro|owner@example.com', 'user', 'view')", Uuid::parse_str(&thread.entity_id)?).execute(tx.as_mut()).await?;
    assert_eq!(
        *ensure_thread_share_permission_in_transaction(&mut tx, &thread.entity_id)
            .await
            .unwrap_err()
            .current_context(),
        TeamShareError::InvalidState
    );
    assert_eq!(
        sqlx::query_scalar!(r#"SELECT count(*) FROM "EmailThreadPermission""#)
            .fetch_one(tx.as_mut())
            .await?,
        Some(0)
    );
    // A pre-existing owner grant is safe and stays unique.
    sqlx::query!(
        "UPDATE entity_access SET access_level = 'owner' WHERE entity_type = 'email_thread'"
    )
    .execute(tx.as_mut())
    .await?;
    apply(&mut tx, &command(&initial, None)).await?;
    assert_eq!(load_facts(&mut tx, &thread).await?.revision, 1);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM entity_access WHERE entity_type = 'email_thread'"
        )
        .fetch_one(tx.as_mut())
        .await?,
        Some(1)
    );
    let permission = sqlx::query!(r#"SELECT sp."linkShare" AS link_share, sp."linkShareAccessLevel" AS "level: AccessLevel" FROM "SharePermission" sp JOIN "EmailThreadPermission" tp ON tp."sharePermissionId" = sp.id"#).fetch_one(tx.as_mut()).await?;
    assert!(permission.link_share.is_none());
    assert!(permission.level.is_none());
    tx.rollback().await?;
    assert_eq!(
        sqlx::query_scalar!(r#"SELECT count(*) FROM "EmailThreadPermission""#)
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn adoption_requires_exact_direct_candidate(pool: PgPool) -> rootcause::Result<()> {
    let document = entity(EntityType::Document, 2);
    let mut tx = pool.begin().await?;
    let facts = load_facts(&mut tx, &document).await?;
    let reviewed = TeamShareGrant {
        team_id: facts.owner_team_id.unwrap(),
        level: TeamShareLevel::View,
    };
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id) VALUES ($1, 'document', $2, 'team', 'view', '20000000-0000-0000-0000-000000000001')", Uuid::parse_str(&document.entity_id)?, reviewed.team_id.to_string()).execute(tx.as_mut()).await?;
    assert_eq!(
        *adopt(&mut tx, &facts, reviewed)
            .await
            .unwrap_err()
            .current_context(),
        TeamShareError::InvalidAdoption
    );
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'document', $2, 'team', 'edit')", Uuid::parse_str(&document.entity_id)?, reviewed.team_id.to_string()).execute(tx.as_mut()).await?;
    assert_eq!(
        *adopt(&mut tx, &facts, reviewed)
            .await
            .unwrap_err()
            .current_context(),
        TeamShareError::InvalidAdoption
    );
    assert_eq!(load_facts(&mut tx, &document).await?, facts);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn creation_intents_and_all_entity_mutations(pool: PgPool) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    for (kind, index, intent, level) in [
        (
            EntityType::Document,
            2,
            TeamShareCreation::ExplicitTask,
            Some(TeamShareLevel::Comment),
        ),
        (
            EntityType::Call,
            5,
            TeamShareCreation::Call,
            Some(TeamShareLevel::View),
        ),
        (EntityType::Call, 6, TeamShareCreation::Unshared, None),
        (EntityType::Project, 1, TeamShareCreation::Unshared, None),
        (EntityType::Chat, 3, TeamShareCreation::Unshared, None),
        (
            EntityType::EmailThread,
            4,
            TeamShareCreation::Unshared,
            None,
        ),
    ] {
        let entity = entity(kind, index);
        initialize(&mut tx, &entity, intent).await?;
        let facts = load_facts(&mut tx, &entity).await?;
        assert_eq!(facts.current.map(|g| g.level), level);
        assert_eq!(facts.revision, i64::from(level.is_some()));
        apply(&mut tx, &command(&facts, Some(AccessLevel::Edit))).await?;
    }
    tx.commit().await?;
    let mut tx = pool.begin().await?;
    for (kind, index) in [
        (EntityType::Document, 2),
        (EntityType::Call, 5),
        (EntityType::Call, 6),
        (EntityType::Project, 1),
        (EntityType::Chat, 3),
        (EntityType::EmailThread, 4),
    ] {
        assert_eq!(
            load_facts(&mut tx, &entity(kind, index))
                .await?
                .current
                .unwrap()
                .level,
            TeamShareLevel::Edit
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("team_share"))
)]
async fn creation_without_membership_and_revision_exhaustion(
    pool: PgPool,
) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    acquire_guard(&mut tx).await?;
    sqlx::query!("DELETE FROM team_user")
        .execute(tx.as_mut())
        .await?;
    let call = entity(EntityType::Call, 5);
    initialize(&mut tx, &call, TeamShareCreation::Call).await?;
    assert_eq!(load_facts(&mut tx, &call).await?.current, None);
    let document = entity(EntityType::Document, 2);
    assert_eq!(
        *initialize(&mut tx, &document, TeamShareCreation::ExplicitTask)
            .await
            .unwrap_err()
            .current_context(),
        TeamShareError::InvalidState
    );
    sqlx::query!(
        r#"UPDATE "SharePermission" SET team_share_revision = $1 WHERE id = 'document'"#,
        i64::MAX
    )
    .execute(tx.as_mut())
    .await?;
    let facts = load_facts(&mut tx, &document).await?;
    assert_eq!(
        *maintain(&mut tx, &TeamShareMaintenance::Clear { expected: facts })
            .await
            .unwrap_err()
            .current_context(),
        TeamShareError::InvalidState
    );
    Ok(())
}
