use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn member_crm_revocation_removes_only_the_requesters_crm_grant(pool: PgPool) {
    let team = setup_shared_team(&pool, true).await;
    let thread = create_thread(&pool, OWNER, "contact@example.com", &[]).await;
    for enabled in [true, false, true] {
        sqlx::query!(
            "UPDATE team_user SET crm_access = $1 WHERE team_id = $2 AND user_id = $3",
            enabled,
            team,
            REQUESTER
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            access_as_requester(&pool, &thread).await,
            enabled.then_some(AccessLevel::Comment)
        );
        #[cfg(feature = "explain_binary")]
        {
            let requester = user(REQUESTER);
            assert_eq!(
                explain_thread_crm(&pool, &thread, &requester)
                    .await
                    .unwrap()
                    .len(),
                usize::from(enabled),
            );
        }
        assert!(
            sqlx::query_scalar!(
                "SELECT enabled FROM crm_email_consent WHERE team_id = $1 AND user_id = $2",
                team,
                OWNER
            )
            .fetch_one(&pool)
            .await
            .unwrap()
        );
    }
    sqlx::query!(
        "UPDATE team_user SET crm_access = false WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        access_as_requester(&pool, &thread).await,
        Some(AccessLevel::Comment),
        "a contributor's viewing restriction does not revoke mailbox consent"
    );
    sqlx::query!(
        "UPDATE team_user SET crm_access = false WHERE team_id = $1",
        team
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        get_thread_access(&pool, &thread, Viewer::User(OWNER))
            .await
            .unwrap(),
        Some(AccessLevel::Owner)
    );
}
