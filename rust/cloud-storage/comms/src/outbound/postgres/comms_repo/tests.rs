#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;

    fn uuid(s: &str) -> Uuid {
        Uuid::parse_str(s).unwrap()
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("latest_messages"))
    )]
    async fn test_get_latest_channel_messages_batch(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let ids = vec![
            uuid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
            uuid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
            uuid("cccccccc-cccc-cccc-cccc-cccccccccccc"),
            uuid("dddddddd-dddd-dddd-dddd-dddddddddddd"),
        ];

        let res = get_latest_channel_messages_batch(&pool, &ids).await?;

        // aaaaaaaa
        let a = res.get(&ids[0]).expect("channel a should exist");
        assert_eq!(
            a.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("aaaaaa2a-0000-0000-0000-000000000002")
        );

        // bbbbbbbb
        let b = res.get(&ids[1]).expect("channel b should exist");
        assert_eq!(
            b.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("bbbbbb2b-0000-0000-0000-000000000003")
        );
        assert!(b.latest_non_thread_message.is_none());

        // cccccccc
        let c = res.get(&ids[2]).expect("channel c should exist");
        assert_eq!(
            c.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("cccccc2c-0000-0000-0000-000000000002")
        );
        assert_eq!(
            c.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("cccccc2c-0000-0000-0000-000000000002")
        );

        // dddddddd
        let d = res.get(&ids[3]).expect("channel d should exist");
        assert_eq!(
            d.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("dddddd1d-0000-0000-0000-000000000001")
        );
        assert_eq!(
            d.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("dddddd1d-0000-0000-0000-000000000001")
        );

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("latest_messages"))
    )]
    async fn test_get_latest_channel_message(pool: sqlx::Pool<sqlx::Postgres>) -> Result<()> {
        let a =
            get_latest_channel_message(&pool, uuid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).await?;

        assert_eq!(
            a.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("aaaaaa2a-0000-0000-0000-000000000004")
        );
        assert_eq!(
            a.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("aaaaaa2a-0000-0000-0000-000000000002")
        );

        let b =
            get_latest_channel_message(&pool, uuid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")).await?;
        assert_eq!(
            b.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("bbbbbb2b-0000-0000-0000-000000000003")
        );
        assert!(b.latest_non_thread_message.is_none());

        let c =
            get_latest_channel_message(&pool, uuid("cccccccc-cccc-cccc-cccc-cccccccccccc")).await?;
        assert_eq!(
            c.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("cccccc2c-0000-0000-0000-000000000002")
        );
        assert_eq!(
            c.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("cccccc2c-0000-0000-0000-000000000002")
        );

        let d =
            get_latest_channel_message(&pool, uuid("dddddddd-dddd-dddd-dddd-dddddddddddd")).await?;
        assert_eq!(
            d.latest_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("dddddd1d-0000-0000-0000-000000000001")
        );
        assert_eq!(
            d.latest_non_thread_message
                .as_ref()
                .map(|m| m.message_id.to_string())
                .as_deref(),
            Some("dddddd1d-0000-0000-0000-000000000001")
        );

        Ok(())
    }
}
