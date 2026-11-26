use super::*;
use crate::domain::{
    models::CommentAccessLevel, ports::EntityAccessService, service::EntityAccessServiceImpl,
};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../call/fixtures", scripts("call_repo"))
)]
async fn channel_call_chat_uses_current_channel_grants_without_direct_participant_grants(
    pool: PgPool,
) -> anyhow::Result<()> {
    let repo = PgAccessRepository::new(pool.clone());
    let service = EntityAccessServiceImpl::new(repo);
    let channel_id = uuid::uuid!("00000000-0000-0000-0000-000000000c01");
    let member = user_id("macro|user-b@test.com");
    let viewer = user_id("macro|user-d@test.com");

    for call_id in [
        "00000000-0000-0000-0000-0000000ca110",
        "00000000-0000-0000-0000-0000000ca2ed",
    ] {
        for level in [AccessLevel::View, AccessLevel::Comment, AccessLevel::Edit] {
            // Channel calls grant their channel Edit on creation. Also verify
            // an explicit Comment grant and that View remains read-only.
            sqlx::query!(
                r#"UPDATE entity_access SET access_level = $3::text::"AccessLevel"
                   WHERE entity_id = $1 AND entity_type = 'call'
                     AND source_id = $2 AND source_type = 'channel'"#,
                Uuid::parse_str(call_id)?,
                channel_id.to_string(),
                level.to_string(),
            )
            .execute(&pool)
            .await?;

            assert_eq!(
                service
                    .get_access_level(Some(&member), call_id, EntityType::Call)
                    .await?,
                Some(level)
            );
            let receipt = service
                .generate_entity_access_receipt::<CommentAccessLevel>(
                    &member,
                    None,
                    call_id,
                    EntityType::Call,
                )
                .await;
            if level >= AccessLevel::Comment {
                assert!(receipt.is_ok());
            } else {
                assert!(matches!(receipt, Err(AccessError::Unauthorized)));
            }
        }

        assert!(matches!(
            service
                .generate_entity_access_receipt::<CommentAccessLevel>(
                    &viewer,
                    None,
                    call_id,
                    EntityType::Call,
                )
                .await,
            Err(AccessError::Unauthorized)
        ));
    }

    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1 AND user_id = $2",
        channel_id,
        member.as_ref(),
    )
    .execute(&pool)
    .await?;
    for call_id in [
        "00000000-0000-0000-0000-0000000ca110",
        "00000000-0000-0000-0000-0000000ca2ed",
    ] {
        assert!(matches!(
            service
                .generate_entity_access_receipt::<CommentAccessLevel>(
                    &member,
                    None,
                    call_id,
                    EntityType::Call,
                )
                .await,
            Err(AccessError::Unauthorized)
        ));
        assert_eq!(
            service
                .get_access_level(None, call_id, EntityType::Call)
                .await?,
            None
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../call/fixtures", scripts("call_repo"))
)]
async fn current_channel_users_are_the_members_who_have_not_left(
    pool: PgPool,
) -> anyhow::Result<()> {
    use crate::domain::ports::EntityAudienceLookup;

    let service = EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone()));
    let channel_id = uuid::uuid!("00000000-0000-0000-0000-000000000c01");
    let current = || async {
        let mut users = service
            .get_current_channel_users(&channel_id.to_string())
            .await?
            .into_iter()
            .map(|user| user.to_string())
            .collect::<Vec<_>>();
        users.sort();
        anyhow::Ok(users)
    };

    let before = current().await?;
    assert_eq!(before.len(), 3, "the fixture's three members");

    let leaver = before[0].clone();
    let joiner = user_id("macro|joiner@example.com");
    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1 AND user_id = $2",
        channel_id,
        leaver,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, $2, 'member')",
        channel_id,
        joiner.as_ref(),
    )
    .execute(&pool)
    .await?;

    let mut expected = before[1..].to_vec();
    expected.push(joiner.to_string());
    expected.sort();
    assert_eq!(current().await?, expected);
    assert!(matches!(
        service.get_current_channel_users("not-a-channel").await,
        Err(AccessError::BadRequest(_))
    ));
    Ok(())
}
