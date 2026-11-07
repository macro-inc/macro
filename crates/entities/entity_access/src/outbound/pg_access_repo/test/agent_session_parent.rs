use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("user_team", "agent_session_sharing")
    )
)]
async fn session_parent_lookup_accepts_live_document_and_call_threads(pool: PgPool) {
    let repo = PgAccessRepository::new(pool.clone());
    let session = uuid::uuid!("60000000-0000-0000-0000-000000000001");
    for kind in ["document", "call", "initiative"] {
        let root = Uuid::now_v7();
        let parent_id = root.to_string();
        sqlx::query!(
            r#"INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id, content)
               VALUES ($1, $2, $3, 'macro|owner@team.com', 'Agent invocation')"#,
            root,
            kind,
            parent_id,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query!(
            "UPDATE agent_session SET thread_id = $1 WHERE id = $2",
            root,
            session
        )
        .execute(&pool)
        .await
        .unwrap();
        let expected = match kind {
            "document" => Some(AgentSessionParent::Document(parent_id)),
            "call" => Some(AgentSessionParent::Call(root)),
            _ => None,
        };
        assert_eq!(
            repo.get_agent_session_parent(&session.to_string())
                .await
                .unwrap(),
            expected
        );

        // Tombstoning one call message does not delete the call's chat thread.
        sqlx::query!(
            "UPDATE comms_messages SET deleted_at = NOW() WHERE id = $1",
            root
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            repo.get_agent_session_parent(&session.to_string())
                .await
                .unwrap(),
            expected
        );
        sqlx::query!(
            "UPDATE comms_message_threads SET deleted_at = NOW() WHERE root_id = $1",
            root
        )
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            repo.get_agent_session_parent(&session.to_string())
                .await
                .unwrap(),
            None
        );
    }
    assert_eq!(
        repo.get_agent_session_parent(&Uuid::now_v7().to_string())
            .await
            .unwrap(),
        None
    );
}
