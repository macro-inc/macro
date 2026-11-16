use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../fixtures", scripts("user_team"))
)]
async fn member_revocation_and_regrant_apply_to_records_and_recipients(
    pool: PgPool,
) -> anyhow::Result<()> {
    let company = Uuid::now_v7();
    insert_company(&pool, company, TEAM_ALPHA, false).await?;
    let contact = Uuid::now_v7();
    sqlx::query!("INSERT INTO crm_contacts (id, team_id, company_id, name, first_interaction, last_interaction) VALUES ($1, $2, $3, 'Contact', now(), now())", contact, TEAM_ALPHA, company).execute(&pool).await?;
    let member_id = sqlx::query_scalar!(
        "SELECT user_id FROM team_user WHERE team_id = $1 AND team_role = 'member'",
        TEAM_ALPHA
    )
    .fetch_one(&pool)
    .await?;
    let member = MacroUserId::parse_from_str(&member_id)?.lowercase();
    for enabled in [true, false, true] {
        sqlx::query!(
            "UPDATE team_user SET crm_access = $1 WHERE user_id = $2",
            enabled,
            member.as_ref()
        )
        .execute(&pool)
        .await?;
        assert_eq!(
            get_crm_company_access(&pool, &company, &member)
                .await?
                .is_some(),
            enabled
        );
        assert_eq!(
            super::super::super::crm_contact_access::get_crm_contact_access(
                &pool, &contact, &member
            )
            .await?
            .is_some(),
            enabled
        );
        let keys = vec![
            (model_entity::EntityType::CrmCompany, company.to_string()),
            (model_entity::EntityType::CrmContact, contact.to_string()),
        ];
        let visible =
            super::super::super::crm_batch_access::visible_entities(&pool, member.as_ref(), &keys)
                .await?;
        assert_eq!(visible.len(), if enabled { 2 } else { 0 });
        let recipients = super::super::super::crm_entity_users::get_crm_entity_users(
            &pool,
            &company,
            model_entity::EntityType::CrmCompany,
        )
        .await?;
        assert_eq!(
            recipients
                .iter()
                .any(|user| user.as_ref() == member.as_ref()),
            enabled
        );
    }
    sqlx::query!(
        "UPDATE team_user SET crm_access = false WHERE team_id = $1",
        TEAM_ALPHA
    )
    .execute(&pool)
    .await?;
    let administrators = sqlx::query_scalar!(
        "SELECT user_id FROM team_user WHERE team_id = $1 AND team_role IN ('admin', 'owner')",
        TEAM_ALPHA
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(administrators.len(), 2);
    for id in administrators {
        let user = MacroUserId::parse_from_str(&id)?.lowercase();
        assert!(
            get_crm_company_access(&pool, &company, &user)
                .await?
                .is_some()
        );
        assert!(
            super::super::super::crm_contact_access::get_crm_contact_access(&pool, &contact, &user)
                .await?
                .is_some()
        );
    }
    Ok(())
}
