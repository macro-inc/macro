use super::*;
use crate::domain::email_policy_api::{
    EmailPolicyAuthoringRepository, EmailPolicyAuthoringTransaction,
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn target_reads_and_locks_preserve_team_visibility_and_live_state(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let foreign_team = Uuid::now_v7();
    seed_team(&pool, foreign_team, "macro|foreign@example.com").await?;
    let company = insert_company(&pool, team, true, &["visible.example.com"]).await?;
    let hidden_company = insert_company(&pool, team, true, &["hidden.example.com"]).await?;
    let empty_company = insert_company(&pool, team, true, &[]).await?;
    let foreign_company =
        insert_company(&pool, foreign_team, true, &["foreign.example.com"]).await?;
    sqlx::query!(
        "UPDATE crm_companies SET hidden=TRUE WHERE id=$1",
        hidden_company
    )
    .execute(&pool)
    .await?;

    let visible_contact = Uuid::now_v7();
    let unfiled_contact = Uuid::now_v7();
    let hidden_contact = Uuid::now_v7();
    let hidden_parent_contact = Uuid::now_v7();
    let empty_contact = Uuid::now_v7();
    let foreign_contact = Uuid::now_v7();
    let foreign_parent_contact = Uuid::now_v7();
    for (id, owner_team, parent, hidden, email) in [
        (
            visible_contact,
            team,
            Some(company),
            false,
            Some("visible@example.com"),
        ),
        (
            unfiled_contact,
            team,
            None,
            false,
            Some("unfiled@example.com"),
        ),
        (
            hidden_contact,
            team,
            Some(company),
            true,
            Some("hidden@example.com"),
        ),
        (
            hidden_parent_contact,
            team,
            Some(hidden_company),
            false,
            Some("child@example.com"),
        ),
        (empty_contact, team, None, false, None),
        (
            foreign_contact,
            foreign_team,
            Some(foreign_company),
            false,
            Some("foreign@example.com"),
        ),
        (
            foreign_parent_contact,
            team,
            Some(foreign_company),
            false,
            Some("invalid@example.com"),
        ),
    ] {
        sqlx::query!(
            r#"INSERT INTO crm_contacts(id,team_id,company_id,hidden,email,first_interaction,last_interaction)
               VALUES($1,$2,$3,$4,$5,now(),now())"#,
            id,owner_team,parent,hidden,email
        ).execute(&pool).await?;
    }

    // Request foreign and missing IDs as well as targets that currently expand
    // to nothing. Only this team's current visible records are returned.
    let mut rules: Vec<_> = [
        company,
        hidden_company,
        empty_company,
        foreign_company,
        Uuid::now_v7(),
    ]
    .into_iter()
    .map(|company_id| EmailInclusionRule::Company { company_id })
    .collect();
    rules.extend(
        [
            visible_contact,
            unfiled_contact,
            hidden_contact,
            hidden_parent_contact,
            empty_contact,
            foreign_contact,
            foreign_parent_contact,
            Uuid::now_v7(),
        ]
        .into_iter()
        .map(|contact_id| EmailInclusionRule::Contact { contact_id }),
    );

    for role in ["member", "admin"] {
        sqlx::query!(
            "UPDATE team_user SET team_role=$3::text::team_role WHERE team_id=$1 AND user_id=$2",
            team,
            OWNER,
            role
        )
        .execute(&pool)
        .await?;
        let mut expected_contacts = vec![
            (visible_contact, true),
            (unfiled_contact, true),
            (empty_contact, false),
        ];
        let mut expected_companies = vec![(company, true), (empty_company, false)];
        if role == "admin" {
            expected_contacts.extend([(hidden_contact, true), (hidden_parent_contact, true)]);
            expected_companies.push((hidden_company, true));
        }
        expected_contacts.sort();
        expected_companies.sort();

        let mut read = repo.email_rule_targets(team, OWNER, link, &rules).await?;
        read.contacts.sort();
        read.companies.sort();
        assert_eq!(read.contacts, expected_contacts);
        assert_eq!(read.companies, expected_companies);

        let mut tx = repo
            .open_email_policy(
                team,
                OWNER,
                OpenEmailPolicy::Initialize {
                    primary_link_id: Some(link),
                },
            )
            .await?
            .expect("current member mailbox");
        let mut locked = tx.lock_rule_targets(&rules).await?;
        locked.contacts.sort();
        locked.companies.sort();
        assert_eq!(locked.contacts, expected_contacts);
        assert_eq!(locked.companies, expected_companies);

        // A plain locking lateral would lock a foreign row before its outer
        // team filter. These NOWAIT reads must succeed on a second connection.
        sqlx::query!(
            "SELECT id FROM crm_companies WHERE id=$1 FOR UPDATE NOWAIT",
            foreign_company
        )
        .fetch_one(&pool)
        .await?;
        sqlx::query!(
            "SELECT id FROM crm_contacts WHERE id=$1 FOR UPDATE NOWAIT",
            foreign_contact
        )
        .fetch_one(&pool)
        .await?;
        for id in [company, hidden_company, empty_company] {
            let error = sqlx::query!(
                "SELECT id FROM crm_companies WHERE id=$1 FOR UPDATE NOWAIT",
                id
            )
            .fetch_one(&pool)
            .await
            .expect_err("referenced parent stays locked");
            assert_eq!(
                error.as_database_error().and_then(|e| e.code()).as_deref(),
                Some("55P03")
            );
        }
        for id in [
            visible_contact,
            unfiled_contact,
            hidden_contact,
            hidden_parent_contact,
            empty_contact,
        ] {
            let error = sqlx::query!(
                "SELECT id FROM crm_contacts WHERE id=$1 FOR UPDATE NOWAIT",
                id
            )
            .fetch_one(&pool)
            .await
            .expect_err("referenced contact stays locked");
            assert_eq!(
                error.as_database_error().and_then(|e| e.code()).as_deref(),
                Some("55P03")
            );
        }
        tx.commit().await?;
    }

    sqlx::query!(
        "DELETE FROM crm_contact_emails WHERE contact_id=$1",
        visible_contact
    )
    .execute(&pool)
    .await?;
    sqlx::query!("DELETE FROM crm_domains WHERE company_id=$1", company)
        .execute(&pool)
        .await?;
    let read = repo.email_rule_targets(team, OWNER, link, &rules).await?;
    assert!(read.contacts.contains(&(visible_contact, false)));
    assert!(read.companies.contains(&(company, false)));
    Ok(())
}
