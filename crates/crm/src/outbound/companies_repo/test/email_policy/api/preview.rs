use super::*;
use crate::domain::{email_policy_preview::*, email_privacy::EmailBlockScope};
use chrono::Utc;

async fn start(app: &Router, rules: Value, previous: Option<Uuid>) -> (StatusCode, Value) {
    let token = request(app, "owner", "/policy", None).await.1["token"].clone();
    request(app,"agent","/preview",Some(json!({"if_policy":token,"if_preview_id":previous,"rules":{"schema_version":1,"include":rules}}))).await
}
async fn allowed(pool: &PgPool, team: Uuid, threads: &[Uuid]) -> anyhow::Result<Vec<Uuid>> {
    Ok(sqlx::query_scalar!(r#"SELECT id AS "id!" FROM unnest($2::uuid[]) ids(id) WHERE crm_email_thread_allowed($1,id) ORDER BY id"#,team,threads).fetch_all(pool).await?)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn previews_are_consent_free_count_only_and_match_committed_eligibility_for_all_selectors(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let company = insert_company(&pool, team, true, &["sample.example.com"]).await?;
    let contact =
        insert_contact_with_source(&pool, company, "first@sample.example.com", link).await?;
    sqlx::query!(
        "INSERT INTO crm_contact_emails(contact_id,email) VALUES($1,'second@sample.example.com')",
        contact
    )
    .execute(&pool)
    .await?;
    let direct = insert_interaction(&pool, link, "direct@example.org", Utc::now(), true).await?;
    let first =
        insert_interaction(&pool, link, "first@sample.example.com", Utc::now(), true).await?;
    let second =
        insert_interaction(&pool, link, "second@sample.example.com", Utc::now(), false).await?;
    let subdomain = insert_interaction(
        &pool,
        link,
        "person@sub.sample.example.com",
        Utc::now(),
        false,
    )
    .await?;
    let unrelated =
        insert_interaction(&pool, link, "person@other.example.com", Utc::now(), true).await?;
    let denied =
        insert_interaction(&pool, link, "second@sample.example.com", Utc::now(), true).await?;
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::SetThreadExclusion {
            thread_id: denied,
            excluded: true,
        },
    )
    .await?;
    let threads = vec![direct, first, second, subdomain, unrelated, denied];
    let app = app(&pool, Arc::new(AtomicBool::new(true)));
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let mut previous: Option<Uuid> = None;
    for rules in [
        json!([{"kind":"thread","thread_id":direct}]),
        json!([{"kind":"address","address":"second@sample.example.com"}]),
        json!([{"kind":"contact","contact_id":contact}]),
        json!([{"kind":"domain","domain":"sample.example.com"}]),
        json!([{"kind":"company","company_id":company}]),
        json!([]),
    ] {
        if let Some(id) = previous {
            sqlx::query!("UPDATE crm_email_policy_previews SET created_at=created_at-interval '31 seconds' WHERE preview_id=$1",id).execute(&pool).await?;
        }
        let before = metadata(&pool, team).await?;
        let current = allowed(&pool, team, &threads).await?;
        let (status, pending) = start(&app, rules.clone(), previous).await;
        assert_eq!(status, StatusCode::OK, "{pending}");
        assert_eq!(
            metadata(&pool, team).await?,
            before,
            "preview must not initialize consent or schedule contribution history"
        );
        previous = Some(Uuid::parse_str(
            pending["preview_id"].as_str().expect("id"),
        )?);
        assert!(service.process_email_preview().await?);
        assert!(!service.process_email_preview().await?);
        let complete = request(&app, "owner", "/preview", None).await.1;
        assert_eq!(complete["status"], "complete", "{complete}");
        assert_eq!(complete["scanned_threads"], 6);
        assert!(!complete["as_of"].is_null());
        assert!(complete.get("rules").is_none() && complete.get("threads").is_none());
        assert_eq!(complete["counts"]["current"], current.len());
        let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
        let (status,committed)=request(&app,"agent","/policy",Some(json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"replace_rules","rules":{"schema_version":1,"include":rules}}}))).await;
        assert_eq!(status, StatusCode::OK, "{committed}");
        let proposed = allowed(&pool, team, &threads).await?;
        assert_eq!(complete["counts"]["proposed"], proposed.len());
        assert_eq!(
            complete["counts"]["added"],
            proposed.iter().filter(|id| !current.contains(id)).count()
        );
        assert_eq!(
            complete["counts"]["removed"],
            current.iter().filter(|id| !proposed.contains(id)).count()
        );
        assert_eq!(
            complete["counts"]["retained"],
            current.iter().filter(|id| proposed.contains(id)).count()
        );
        assert!(!proposed.contains(&denied));
        assert_eq!(
            request(&app, "owner", "/preview", None).await.1["status"],
            "stale"
        );
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn preview_snapshot_is_stable_across_import_and_cannot_publish_after_privacy_change(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let app = app(&pool, Arc::new(AtomicBool::new(true)));
    for n in 0..101 {
        insert_interaction(
            &pool,
            link,
            &format!("person{n}@example.net"),
            Utc::now(),
            true,
        )
        .await?;
    }
    assert_eq!(
        start(
            &app,
            json!([{"kind":"domain","domain":"example.net"}]),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let job = repo.claim_email_preview().await?.expect("queued");
    let mut snapshot = repo
        .open_email_preview(&job)
        .await?
        .expect("authorized snapshot");
    let first = snapshot.next_page(15_000).await?;
    assert_eq!(first.scanned_threads, 100);
    assert_eq!(first.counts.proposed, 100);
    insert_interaction(&pool, link, "new@example.net", Utc::now(), true).await?;
    let second = snapshot.next_page(15_000).await?;
    assert_eq!(second.scanned_threads, 1);
    assert_eq!(second.counts.proposed, 1);
    let mut view = job.view.clone();
    view.as_of = Some(snapshot.as_of());
    view.counts.proposed = 101;
    view.counts.added = 101;
    view.scanned_threads = 101;
    view.status = EmailPolicyPreviewStatus::Complete;
    drop(snapshot);
    assert!(repo.finish_email_preview(&job, &view).await?);
    assert_eq!(
        repo.email_preview(team, OWNER)
            .await?
            .expect("view")
            .counts
            .proposed,
        101
    );
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::AddDomain {
            scope: EmailBlockScope::Personal,
            domain: "example.net".into(),
        },
    )
    .await?;
    assert_eq!(
        repo.email_preview(team, OWNER)
            .await?
            .expect("stale")
            .status,
        EmailPolicyPreviewStatus::Stale
    );
    assert!(
        !repo.finish_email_preview(&job, &view).await?,
        "late completion cannot restore an invalidated count"
    );
    assert!(metadata(&pool, team).await?["consent"].is_null());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn preview_retries_replacement_cancellation_and_expiry_are_bounded(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, _, repo) = setup(&pool).await?;
    let app = app(&pool, Arc::new(AtomicBool::new(true)));
    let rules = json!([{"kind":"domain","domain":"example.com"}]);
    let (status, first) = start(&app, rules.clone(), None).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(
        start(&app, rules.clone(), None).await.1,
        first,
        "same start is a read-only retry"
    );
    let id = Uuid::parse_str(first["preview_id"].as_str().expect("preview id"))?;
    let job = repo.claim_email_preview().await?.expect("job");
    assert_eq!(
        start(&app, json!([]), Some(id)).await.0,
        StatusCode::TOO_MANY_REQUESTS
    );
    repo.cancel_email_preview(team, OWNER, id).await?;
    let mut late = job.view.clone();
    late.status = EmailPolicyPreviewStatus::Complete;
    assert!(!repo.finish_email_preview(&job, &late).await?);
    sqlx::query!("UPDATE crm_email_policy_previews SET created_at=created_at-interval '31 seconds' WHERE team_id=$1",team).execute(&pool).await?;
    let (status, replaced) = start(&app, json!([]), Some(id)).await;
    assert_eq!(status, StatusCode::OK, "{replaced}");
    assert_ne!(first["preview_id"], replaced["preview_id"]);
    assert_eq!(
        start(&app, rules, None).await.0,
        StatusCode::CONFLICT,
        "a delayed start cannot resurrect an older job"
    );
    sqlx::query!("UPDATE crm_email_policy_previews SET created_at=now()-interval '10 minutes',expires_at=now()-interval '1 minute' WHERE team_id=$1",team).execute(&pool).await?;
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    assert!(service.process_email_preview().await?);
    let view = repo.email_preview(team, OWNER).await?.expect("partial");
    assert_eq!(view.status, EmailPolicyPreviewStatus::Partial);
    assert_eq!(view.scanned_threads, 0);
    assert!(view.as_of.is_none());
    assert!(metadata(&pool, team).await?["consent"].is_null());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unmatched_preview_stops_at_raw_thread_budget_instead_of_scanning_until_a_match(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    sqlx::query!("INSERT INTO email_threads(id,link_id) SELECT gen_random_uuid(),$1 FROM generate_series(1,10001)",link).execute(&pool).await?;
    let app = app(&pool, Arc::new(AtomicBool::new(true)));
    assert_eq!(start(&app, json!([]), None).await.0, StatusCode::OK);
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    assert!(service.process_email_preview().await?);
    let view = repo
        .email_preview(team, OWNER)
        .await?
        .expect("bounded result");
    assert_eq!(view.status, EmailPolicyPreviewStatus::Partial);
    assert_eq!(view.scanned_threads, 10_000);
    assert_eq!(view.counts.proposed, 0);
    assert_eq!(view.counts.current, 0);
    assert!(metadata(&pool, team).await?["consent"].is_null());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn all_mail_preview_matches_current_eligibility_and_live_target_edits_invalidate_it(
    pool: PgPool,
) -> anyhow::Result<()> {
    use crate::domain::{companies_repo::CompaniesRepository, contact_update::ContactFieldUpdate};
    let (team, link, repo) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let company = insert_company(&pool, team, true, &["sample.example.com"]).await?;
    let contact =
        insert_contact_with_source(&pool, company, "first@sample.example.com", link).await?;
    let first =
        insert_interaction(&pool, link, "first@sample.example.com", Utc::now(), true).await?;
    let second =
        insert_interaction(&pool, link, "second@sample.example.com", Utc::now(), true).await?;
    let unrelated = insert_interaction(&pool, link, "other@example.org", Utc::now(), true).await?;
    let app = app(&pool, Arc::new(AtomicBool::new(true)));
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let (status, pending) =
        start(&app, json!([{"kind":"contact","contact_id":contact}]), None).await;
    assert_eq!(status, StatusCode::OK, "{pending}");
    assert!(service.process_email_preview().await?);
    let complete = request(&app, "owner", "/preview", None).await.1;
    assert_eq!(complete["status"], "complete");
    assert_eq!(
        complete["counts"]["current"],
        allowed(&pool, team, &[first, second, unrelated])
            .await?
            .len()
    );
    assert_eq!(complete["counts"]["proposed"], 1);
    repo.update_contact_details(
        &team,
        &contact,
        &ContactFieldUpdate::AddEmail("second@sample.example.com".into()),
        true,
    )
    .await?;
    assert_eq!(
        request(&app, "owner", "/preview", None).await.1["status"],
        "stale"
    );
    let id = Uuid::parse_str(pending["preview_id"].as_str().expect("id"))?;
    sqlx::query!("UPDATE crm_email_policy_previews SET created_at=created_at-interval '31 seconds' WHERE team_id=$1",team).execute(&pool).await?;
    assert_eq!(
        start(
            &app,
            json!([{"kind":"contact","contact_id":contact}]),
            Some(id)
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(service.process_email_preview().await?);
    assert_eq!(
        request(&app, "owner", "/preview", None).await.1["counts"]["proposed"],
        2
    );
    repo.set_company_hidden(&team, &company, true).await?;
    assert_eq!(
        request(&app, "owner", "/preview", None).await.1["status"],
        "stale"
    );
    Ok(())
}
