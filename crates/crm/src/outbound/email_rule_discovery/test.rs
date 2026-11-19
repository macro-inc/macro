use super::*;

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../email/fixtures", scripts("email_crm_selected"))
)]
async fn small_matching_stops_before_the_suffix_allowance_is_exceeded(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    let link = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0011);
    let ids = [
        Uuid::from_u128(101),
        Uuid::from_u128(102),
        Uuid::from_u128(103),
    ];
    sqlx::query!("INSERT INTO email_contacts(id,link_id,email_address) SELECT id,$1,address FROM unnest($2::uuid[],$3::text[]) value(id,address)",link,&ids[..],&["a@sub.example","b@sub.example","c@sub.example"] as &[&str])
        .execute(&pool).await?;
    let mut tx = pool.begin().await?;
    let mut reader = Reader {
        connection: &mut tx,
        deadline: Instant::now() + std::time::Duration::from_secs(10),
    };
    let result = reader
        .small_matches(link, &[], &["example".into()], 3, 1024, 4)
        .await?;
    assert_eq!(result.rows, 3);
    assert_eq!(
        result.suffix_checks, 6,
        "raw accounting must expose the overflow"
    );
    assert_eq!(result.ids.len(), 2, "matching stops at the allowance");
    assert!(result.ids.iter().all(|id| ids.contains(id)));
    tx.rollback().await?;
    Ok(())
}

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../email/fixtures", scripts("email_crm_selected"))
)]
async fn batched_first_pages_preserve_values_continuations_and_byte_guards(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0001);
    let company = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0041);
    let contact = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0042);
    let empty = Uuid::from_u128(71);
    sqlx::query!("INSERT INTO crm_contacts(id,company_id,team_id,email,first_interaction,last_interaction) VALUES($1,$2,$3,NULL,'2026-01-01','2026-01-02')",empty,company,team).execute(&pool).await?;
    sqlx::query!("INSERT INTO crm_domains(company_id,domain,team_id) SELECT $1,'DOMAIN'||i||'.example',$2 FROM generate_series(1,9)i",company,team).execute(&pool).await?;
    let sources = [
        RuleSource::Contact(contact),
        RuleSource::Contact(empty),
        RuleSource::Company(company),
    ];
    let mut tx = pool.begin().await?;
    let mut reader = Reader {
        connection: &mut tx,
        deadline: Instant::now() + std::time::Duration::from_secs(10),
    };
    let pages = reader.source_first_pages(team, &sources, 8, 8192).await?;
    assert_eq!(pages.len(), 3);
    for page in pages {
        let expected = reader
            .source_values(team, page.source, None, 8, 8192)
            .await?;
        let fields = |rows: &[RuleSourceValue]| {
            rows.iter()
                .map(|r| (r.key.clone(), r.value.clone(), r.bytes, r.in_team))
                .collect::<Vec<_>>()
        };
        assert_eq!(fields(&page.values), fields(&expected));
        if page.source == RuleSource::Company(company) {
            assert_eq!(page.values.len(), 8);
            let after = page.values.last().and_then(|row| row.key.as_deref());
            let rest = reader
                .source_values(team, page.source, after, 8, 8192)
                .await?;
            assert_eq!(rest.len(), 2);
            assert!(
                page.values
                    .iter()
                    .chain(&rest)
                    .all(|v| v.value.as_ref().is_some_and(|s| s == &s.to_lowercase()))
            );
        }
        if page.source == RuleSource::Contact(empty) {
            assert!(page.values.is_empty());
        }
    }
    sqlx::query!(
        "INSERT INTO crm_contact_emails(contact_id,email) VALUES($1,repeat('x',4097))",
        empty
    )
    .execute(&mut *reader.connection)
    .await?;
    let pages = reader.source_first_pages(team, &sources, 8, 8192).await?;
    let row = pages
        .iter()
        .find(|p| p.source == RuleSource::Contact(empty))
        .and_then(|p| p.values.first())
        .expect("oversized value remains accounted");
    assert_eq!(row.bytes, 4097);
    assert!(row.key.is_none() && row.value.is_none());
    tx.rollback().await?;
    Ok(())
}
