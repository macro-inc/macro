use super::helpers::*;
use crate::domain::comment::CrmCommentEntityType;
use crate::domain::companies_repo::*;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_opens_thread_on_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "first comment",
            None,
            false,
        )
        .await?;

    assert_eq!(ct.thread.entity_type, CrmCommentEntityType::CrmCompany);
    assert_eq!(ct.thread.entity_id, company_id);
    assert_eq!(ct.thread.owner, owner);
    assert_eq!(ct.comments.len(), 1);
    assert_eq!(ct.comments[0].text, "first comment");
    assert_eq!(ct.comments[0].owner, owner);
    assert_eq!(ct.comments[0].thread_id, ct.thread.thread_id);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_opens_thread_on_contact(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let contact_id = insert_contact(&pool, company_id, "alice@acme.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmContact,
            &contact_id,
            owner,
            None,
            None,
            "hi alice",
            None,
            false,
        )
        .await?;

    assert_eq!(ct.thread.entity_type, CrmCommentEntityType::CrmContact);
    assert_eq!(ct.thread.entity_id, contact_id);
    assert_eq!(ct.comments.len(), 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_reply_appends_to_thread(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let root = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "root",
            None,
            false,
        )
        .await?;
    let thread_id = root.thread.thread_id;

    repo.create_crm_comment(
        &team_id,
        CrmCommentEntityType::CrmCompany,
        &company_id,
        owner,
        Some(thread_id),
        None,
        "reply",
        None,
        false,
    )
    .await?;

    // One thread, two comments, oldest-first.
    let threads = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            false,
        )
        .await?;
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].thread.thread_id, thread_id);
    assert_eq!(threads[0].comments.len(), 2);
    assert_eq!(threads[0].comments[0].text, "root");
    assert_eq!(threads[0].comments[1].text, "reply");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_unknown_company_404(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &Uuid::now_v7(),
            owner,
            None,
            None,
            "x",
            None,
            false,
        )
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_cross_team_404(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    // Team B cannot comment on team A's company.
    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .create_crm_comment(
            &team_b,
            CrmCommentEntityType::CrmCompany,
            &company_a,
            "macro|b@test.com",
            None,
            None,
            "x",
            None,
            false,
        )
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_reply_to_foreign_thread_404(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_1 = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let company_2 = insert_company(&pool, team_id, true, &["beta.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let root = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_1,
            owner,
            None,
            None,
            "root",
            None,
            false,
        )
        .await?;

    // Replying with company_1's thread id but addressing company_2 must 404.
    let result = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_2,
            owner,
            Some(root.thread.thread_id),
            None,
            "reply",
            None,
            false,
        )
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::ThreadNotFound)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_crm_comment_threads_empty_for_owned_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let threads = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            false,
        )
        .await?;
    assert!(threads.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_crm_comment_threads_unknown_company_404(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &Uuid::now_v7(),
            false,
        )
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn edit_crm_comment_updates_text(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "before",
            None,
            false,
        )
        .await?;
    let comment_id = ct.comments[0].comment_id;

    let updated = repo
        .edit_crm_comment(&team_id, &comment_id, "after", false, owner)
        .await?;
    assert_eq!(updated.text, "after");

    let threads = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            false,
        )
        .await?;
    assert_eq!(threads[0].comments[0].text, "after");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn edit_crm_comment_cross_team_404(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_a,
            CrmCommentEntityType::CrmCompany,
            &company_a,
            "macro|a@test.com",
            None,
            None,
            "secret",
            None,
            false,
        )
        .await?;

    let result = repo
        .edit_crm_comment(
            &team_b,
            &ct.comments[0].comment_id,
            "hacked",
            false,
            "macro|a@test.com",
        )
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CommentNotFound)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_crm_comment_removes_empty_thread(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let ct = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "only comment",
            None,
            false,
        )
        .await?;

    let result = repo
        .delete_crm_comment(&team_id, &ct.comments[0].comment_id, false, owner)
        .await?;
    assert!(result.thread_deleted);
    assert_eq!(result.thread_id, ct.thread.thread_id);
    assert_eq!(count_threads(&pool).await?, 0);

    let threads = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            false,
        )
        .await?;
    assert!(threads.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_crm_comment_keeps_thread_with_remaining(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let root = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "root",
            None,
            false,
        )
        .await?;
    repo.create_crm_comment(
        &team_id,
        CrmCommentEntityType::CrmCompany,
        &company_id,
        owner,
        Some(root.thread.thread_id),
        None,
        "reply",
        None,
        false,
    )
    .await?;

    // Deleting the root leaves the thread alive with the reply.
    let result = repo
        .delete_crm_comment(&team_id, &root.comments[0].comment_id, false, owner)
        .await?;
    assert!(!result.thread_deleted);

    let threads = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            false,
        )
        .await?;
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].comments.len(), 1);
    assert_eq!(threads[0].comments[0].text, "reply");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_crm_comment_cross_team_404(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_a,
            CrmCommentEntityType::CrmCompany,
            &company_a,
            "macro|a@test.com",
            None,
            None,
            "secret",
            None,
            false,
        )
        .await?;

    let result = repo
        .delete_crm_comment(
            &team_b,
            &ct.comments[0].comment_id,
            false,
            "macro|a@test.com",
        )
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CommentNotFound)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_company_cascades_to_threads(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.create_crm_comment(
        &team_id,
        CrmCommentEntityType::CrmCompany,
        &company_id,
        owner,
        None,
        None,
        "doomed",
        None,
        false,
    )
    .await?;
    assert_eq!(count_threads(&pool).await?, 1);

    // Hard-deleting the company cascades to its threads (and their comments).
    sqlx::query(r#"DELETE FROM crm_companies WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;
    assert_eq!(count_threads(&pool).await?, 0);
    Ok(())
}

// ---------------------------------------------------------------------------
// Comments: admin-visibility on hidden parent entities
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_crm_comment_threads_admin_sees_hidden_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    // Seed a thread while the company is visible.
    repo.create_crm_comment(
        &team_id,
        CrmCommentEntityType::CrmCompany,
        &company_id,
        owner,
        None,
        None,
        "hi",
        None,
        false,
    )
    .await?;

    // Hide the company.
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    // Member: 404 — hidden parent treated as not found.
    let member = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            false,
        )
        .await;
    assert!(matches!(
        member,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));

    // Admin: thread is reachable.
    let admin = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            true,
        )
        .await?;
    assert_eq!(admin.len(), 1);
    assert_eq!(admin[0].comments.len(), 1);
    assert_eq!(admin[0].comments[0].text, "hi");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_crm_comment_blocks_member_on_hidden_entity(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    // Member: can't write to a hidden parent.
    let member = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "blocked",
            None,
            false,
        )
        .await;
    assert!(matches!(
        member,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));

    // Admin: write succeeds.
    let admin = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "ok",
            None,
            true,
        )
        .await?;
    assert_eq!(admin.comments.len(), 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn edit_delete_crm_comment_block_member_on_hidden_entity(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let thread = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "first",
            None,
            false,
        )
        .await?;
    let comment_id = thread.comments[0].comment_id;

    // Hide the company AFTER the comment was created (so a hidden-parent
    // edit/delete is the only thing under test).
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    // Member: edit and delete both 404 because the parent is hidden.
    assert!(matches!(
        repo.edit_crm_comment(&team_id, &comment_id, "edited", false, owner)
            .await,
        Err(crate::domain::model::CrmError::CommentNotFound)
    ));
    assert!(matches!(
        repo.delete_crm_comment(&team_id, &comment_id, false, owner)
            .await,
        Err(crate::domain::model::CrmError::CommentNotFound)
    ));

    // Author with admin visibility: edit then delete succeed even on a
    // hidden parent (members 404 above; only the author may mutate).
    let edited = repo
        .edit_crm_comment(&team_id, &comment_id, "edited by admin", true, owner)
        .await?;
    assert_eq!(edited.text, "edited by admin");
    repo.delete_crm_comment(&team_id, &comment_id, true, owner)
        .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crm_comment_visibility_on_hidden_contact_with_visible_company(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Closes the contact-side dimension of the hide matrix:
    // company is visible, but `crm_contacts.hidden = TRUE`. Members
    // 404 on every read/write touching the contact; admins reach
    // everything. Without this case the `entity_owned_by_team` helper's
    // contact arm (which checks BOTH `c.hidden` and `co.hidden`) is
    // only exercised end-to-end via the cascade — this pins
    // contact-only hide as a first-class state.
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let contact_id = insert_contact(&pool, company_id, "alice@acme.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    // Seed a thread on the contact while it's visible.
    let thread = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmContact,
            &contact_id,
            owner,
            None,
            None,
            "first",
            None,
            false,
        )
        .await?;
    let comment_id = thread.comments[0].comment_id;

    // Hide just the contact; parent company stays visible.
    sqlx::query(r#"UPDATE crm_contacts SET hidden = TRUE WHERE id = $1"#)
        .bind(contact_id)
        .execute(&pool)
        .await?;

    // Member view: every operation on the now-hidden contact 404s.
    let member_list = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmContact,
            &contact_id,
            false,
        )
        .await;
    assert!(matches!(
        member_list,
        Err(crate::domain::model::CrmError::ContactNotFoundForTeam)
    ));

    let member_create = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmContact,
            &contact_id,
            owner,
            None,
            None,
            "blocked",
            None,
            false,
        )
        .await;
    assert!(matches!(
        member_create,
        Err(crate::domain::model::CrmError::ContactNotFoundForTeam)
    ));

    assert!(matches!(
        repo.edit_crm_comment(&team_id, &comment_id, "edited", false, owner)
            .await,
        Err(crate::domain::model::CrmError::CommentNotFound)
    ));
    assert!(matches!(
        repo.delete_crm_comment(&team_id, &comment_id, false, owner)
            .await,
        Err(crate::domain::model::CrmError::CommentNotFound)
    ));

    // Admin visibility reaches the hidden contact; the author (with that
    // visibility) can edit + delete in sequence. Thread + comment survive.
    let admin_threads = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmContact,
            &contact_id,
            true,
        )
        .await?;
    assert_eq!(admin_threads.len(), 1);
    assert_eq!(admin_threads[0].comments.len(), 1);

    let edited = repo
        .edit_crm_comment(&team_id, &comment_id, "edited by admin", true, owner)
        .await?;
    assert_eq!(edited.text, "edited by admin");

    repo.delete_crm_comment(&team_id, &comment_id, true, owner)
        .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn edit_crm_comment_non_owner_forbidden(pool: PgPool) -> anyhow::Result<()> {
    // A teammate who can see the comment still cannot edit it — only the
    // author may. The parent is visible to the caller, so this is
    // `CommentNotOwned` (403), not `CommentNotFound` (404).
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "mine",
            None,
            false,
        )
        .await?;
    let comment_id = ct.comments[0].comment_id;

    let result = repo
        .edit_crm_comment(
            &team_id,
            &comment_id,
            "hijacked",
            false,
            "macro|intruder@test.com",
        )
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CommentNotOwned)
    ));

    // The original text is untouched.
    let threads = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            false,
        )
        .await?;
    assert_eq!(threads[0].comments[0].text, "mine");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_crm_comment_non_owner_forbidden(pool: PgPool) -> anyhow::Result<()> {
    // Same rule for delete: a non-author teammate gets `CommentNotOwned`
    // and the comment survives.
    let team_id = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team_id, owner).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let ct = repo
        .create_crm_comment(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            owner,
            None,
            None,
            "mine",
            None,
            false,
        )
        .await?;
    let comment_id = ct.comments[0].comment_id;

    let result = repo
        .delete_crm_comment(&team_id, &comment_id, false, "macro|intruder@test.com")
        .await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CommentNotOwned)
    ));

    let threads = repo
        .get_crm_comment_threads(
            &team_id,
            CrmCommentEntityType::CrmCompany,
            &company_id,
            false,
        )
        .await?;
    assert_eq!(threads[0].comments.len(), 1);
    Ok(())
}
