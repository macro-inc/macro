use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("email_owned_address_read", "email_sender_probe_cap")
    )
)]
async fn sender_probe_caps_message_rows(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let filter = Expr::Literal(EmailLiteral::Sender(Email::Partial("@probe.test".into())));
    let links = [link(0)];
    let request = Request::all(&links, &filter, 3);
    let expected = pages(&pool, &request, None).await?;
    assert_eq!(expected.rows[0].len(), 3);

    // Count the sender's thirteen message rows, not its three threads. At
    // cap 12 or 6 the dense path must preserve all three complete previews.
    for cap in [13, 12, 6] {
        let tuning = OwnedReadTuning {
            superset_limit: cap,
            window_per_row: 1,
            ..OwnedReadTuning::DEFAULT
        };
        let actual = pages(&pool, &request, Some(tuning)).await?;
        assert_eq!(actual.printed(), expected.printed(), "pages at cap {cap}");
        let first = actual.stats[0].unwrap();
        assert_eq!(
            first.streams == OwnedStreams::Superset,
            cap == 13,
            "the probe must count message rows at cap {cap}: {first:?}"
        );
    }
    Ok(())
}
