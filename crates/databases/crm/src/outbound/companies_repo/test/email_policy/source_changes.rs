use super::*;
use crate::domain::{companies_repo::CompaniesRepository, contact_update::ContactFieldUpdate};

async fn reference(
    pool: &PgPool,
    team: Uuid,
    link: Uuid,
    contact: Uuid,
    company: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(r#"INSERT INTO crm_email_rule_revisions(team_id,user_id,revision,link_id,schema_version,definition)
        VALUES($1,$2,1,$3,1,'{"schema_version":1,"include":[]}'::jsonb)"#,team,OWNER,link).execute(pool).await?;
    sqlx::query!("INSERT INTO crm_email_rule_contacts(team_id,user_id,revision,contact_id) VALUES($1,$2,1,$3)",team,OWNER,contact).execute(pool).await?;
    sqlx::query!("INSERT INTO crm_email_rule_companies(team_id,user_id,revision,company_id) VALUES($1,$2,1,$3)",team,OWNER,company).execute(pool).await?;
    Ok(())
}
async fn events(pool: &PgPool, team: Uuid) -> anyhow::Result<Vec<(String, Uuid)>> {
    Ok(sqlx::query!("SELECT source_kind,source_id FROM crm_email_policy_source_events WHERE team_id=$1 ORDER BY source_kind,source_id",team).fetch_all(pool).await?.into_iter().map(|r|(r.source_kind,r.source_id)).collect())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn matching_edits_record_only_referenced_sources_and_noop_or_failed_edits_record_nothing(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    enable_crm_for_team(&pool, team).await?;
    let company = insert_company(&pool, team, true, &["sample.example.com"]).await?;
    // Generate provider addresses only for personal-domain classification.
    let personal_address = format!("{}@{}", Uuid::now_v7(), "gmail.com");
    let additional_address = format!("{}@{}", Uuid::now_v7(), "gmail.com");
    let contact = insert_contact_with_source(&pool, company, &personal_address, link).await?;
    let unreferenced =
        insert_contact_with_source(&pool, company, "other@sample.example.com", link).await?;
    repo.set_contact_hidden(&team, &unreferenced, true).await?;
    assert!(events(&pool, team).await?.is_empty());
    reference(&pool, team, link, contact, company).await?;
    repo.set_company_custom_name(&team, &company, "Updated name", true)
        .await?;
    assert!(
        events(&pool, team).await?.is_empty(),
        "metadata does not affect matching"
    );
    let add = ContactFieldUpdate::AddEmail(additional_address.clone());
    repo.update_contact_details(&team, &contact, &add, true)
        .await?;
    assert_eq!(
        events(&pool, team).await?,
        vec![("contact".into(), contact)]
    );
    repo.update_contact_details(&team, &contact, &add, true)
        .await?;
    let invalid = ContactFieldUpdate::AddEmail("other@sample.example.com".into());
    assert!(
        repo.update_contact_details(&team, &contact, &invalid, true)
            .await
            .is_err()
    );
    assert_eq!(events(&pool, team).await?.len(), 1);
    for primary in [additional_address.clone(), personal_address] {
        repo.update_contact_details(&team, &contact, &ContactFieldUpdate::Email(primary), true)
            .await?;
        assert_eq!(
            events(&pool, team).await?.len(),
            1,
            "choosing an existing primary does not change live matching"
        );
    }
    repo.update_contact_details(
        &team,
        &contact,
        &ContactFieldUpdate::RemoveEmail(additional_address),
        true,
    )
    .await?;
    let destination = insert_company(&pool, team, true, &["other.example.com"]).await?;
    repo.update_contact_details(
        &team,
        &contact,
        &ContactFieldUpdate::Company(destination),
        true,
    )
    .await?;
    repo.set_contact_hidden(&team, &contact, true).await?;
    assert_eq!(
        events(&pool, team).await?,
        vec![("contact".into(), contact); 4]
    );
    repo.set_contact_hidden(&team, &contact, true).await?;
    assert_eq!(
        events(&pool, team).await?.len(),
        4,
        "repeated hide is a no-op"
    );
    repo.set_contact_hidden(&team, &contact, false).await?;
    repo.set_contact_hidden(&team, &contact, false).await?;
    assert_eq!(
        events(&pool, team).await?.len(),
        5,
        "repeated unhide is a no-op"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn company_hide_cascade_records_the_parent_and_only_referenced_contacts_atomically(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let company = insert_company(&pool, team, true, &["sample.example.com"]).await?;
    let contact =
        insert_contact_with_source(&pool, company, "person@sample.example.com", link).await?;
    for n in 0..20 {
        insert_contact_with_source(
            &pool,
            company,
            &format!("other{n}@sample.example.com"),
            link,
        )
        .await?;
    }
    reference(&pool, team, link, contact, company).await?;
    repo.set_company_hidden(&team, &company, true).await?;
    assert_eq!(
        events(&pool, team).await?,
        vec![("company".into(), company), ("contact".into(), contact)]
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_contacts WHERE company_id=$1 AND hidden",
            company
        )
        .fetch_one(&pool)
        .await?,
        Some(21)
    );
    repo.set_company_hidden(&team, &company, true).await?;
    assert_eq!(
        events(&pool, team).await?.len(),
        2,
        "repeated hide is a no-op"
    );
    repo.set_company_hidden(&team, &company, false).await?;
    assert_eq!(events(&pool, team).await?.len(), 4);
    repo.set_company_hidden(&team, &company, false).await?;
    assert_eq!(
        events(&pool, team).await?.len(),
        4,
        "repeated unhide is a no-op"
    );
    // An unchanged parent must still restore an individually hidden contact.
    repo.set_contact_hidden(&team, &contact, true).await?;
    repo.set_company_hidden(&team, &company, false).await?;
    assert_eq!(events(&pool, team).await?.len(), 6);
    assert_eq!(fetch_contact_hidden(&pool, contact).await?, Some(false));
    // The event and edit are one transaction even if durable hand-off fails.
    sqlx::query("CREATE FUNCTION reject_source_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic source failure'; END $$").execute(&pool).await?;
    sqlx::query("CREATE TRIGGER reject_source_event BEFORE INSERT ON crm_email_policy_source_events FOR EACH ROW EXECUTE FUNCTION reject_source_event()").execute(&pool).await?;
    assert!(
        repo.set_company_hidden(&team, &company, true)
            .await
            .is_err()
    );
    assert_eq!(fetch_company_hidden(&pool, company).await?, Some(false));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_contacts WHERE company_id=$1 AND hidden",
            company
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    assert_eq!(events(&pool, team).await?.len(), 6);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deletion_events_retain_targets_after_single_contact_and_bulk_teardown(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let company = insert_company(&pool, team, true, &["sample.example.com"]).await?;
    let contact =
        insert_contact_with_source(&pool, company, "person@sample.example.com", link).await?;
    reference(&pool, team, link, contact, company).await?;
    let outcome = repo
        .depopulate_contact(
            &team,
            &link,
            "sample.example.com",
            "person@sample.example.com",
        )
        .await?;
    assert!(outcome.contact_deleted && outcome.company_deleted);
    assert_eq!(
        events(&pool, team).await?,
        vec![("company".into(), company), ("contact".into(), contact)]
    );
    let company2 = insert_company(&pool, team, true, &["other.example.com"]).await?;
    let contact2 =
        insert_contact_with_source(&pool, company2, "person@other.example.com", link).await?;
    sqlx::query!("INSERT INTO crm_email_rule_contacts(team_id,user_id,revision,contact_id) VALUES($1,$2,1,$3)",team,OWNER,contact2).execute(&pool).await?;
    sqlx::query!("INSERT INTO crm_email_rule_companies(team_id,user_id,revision,company_id) VALUES($1,$2,1,$3)",team,OWNER,company2).execute(&pool).await?;
    repo.depopulate_link_in_team(&team, &link).await?;
    let all = events(&pool, team).await?;
    assert_eq!(all.len(), 4);
    assert!(
        all.contains(&("contact".into(), contact2)) && all.contains(&("company".into(), company2))
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_contacts WHERE team_id=$1", team)
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_hide_and_link_teardown_preserve_the_callers_statement_timeout(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, _) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let company = insert_company(&pool, team, true, &["sample.example.com"]).await?;
    let contact =
        insert_contact_with_source(&pool, company, "person@sample.example.com", link).await?;
    // These trigger objects exist only in this isolated test database. Observe
    // the setting inside each real mutation without waiting for a long query.
    sqlx::query(
        r#"CREATE FUNCTION require_caller_statement_timeout() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF current_setting('statement_timeout')::interval <> interval '90 seconds' THEN
                RAISE EXCEPTION 'mutation replaced the caller statement timeout';
            END IF;
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END $$"#,
    )
    .execute(&pool)
    .await?;
    sqlx::query("CREATE TRIGGER require_caller_timeout BEFORE UPDATE OR DELETE ON crm_companies FOR EACH ROW EXECUTE FUNCTION require_caller_statement_timeout()")
        .execute(&pool).await?;
    sqlx::query("CREATE TRIGGER require_caller_timeout BEFORE UPDATE OR DELETE ON crm_contacts FOR EACH ROW EXECUTE FUNCTION require_caller_statement_timeout()")
        .execute(&pool).await?;
    let caller_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect_with(
            pool.connect_options()
                .as_ref()
                .clone()
                .options([("statement_timeout", "90s")]),
        )
        .await?;
    let repo = CompaniesRepositoryImpl::new(caller_pool.clone());
    repo.set_contact_hidden(&team, &contact, true).await?;
    repo.set_contact_hidden(&team, &contact, false).await?;
    repo.set_company_hidden(&team, &company, true).await?;
    repo.set_company_hidden(&team, &company, false).await?;
    repo.depopulate_link_in_team(&team, &link).await?;
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_contacts WHERE team_id=$1", team)
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    caller_pool.close().await;
    Ok(())
}
