//! The company read and Team list routes over real access checks, the real
//! service and migrated storage.
use super::*;
use crate::{
    domain::service::CrmServiceImpl,
    inbound::axum_router::{CrmRouterState, get_company, list_company_contacts_page},
    outbound::no_op_resolver::NoOpCompanyMetadataResolver,
};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::get,
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedCredential,
    ValidatedIdentity,
};
use serde_json::Value;
use std::sync::Arc;
use tower::ServiceExt;

/// The owner `seed_company` gives its team.
const OWNER: &str = "macro|owner@owner.test";
const MEMBER: &str = "macro|member@owner.test";
const OUTSIDER: &str = "macro|outsider@outsider.test";

/// Signs in as the user its bearer token names.
#[derive(Clone)]
struct FixtureCredential;

impl JwtValidator for FixtureCredential {
    fn validate_credential(
        &self,
        token: &str,
    ) -> Result<ValidatedCredential, rootcause::Report<MacroAuthorizationError>> {
        let user = match token {
            "owner" => OWNER,
            "member" => MEMBER,
            "outsider" => OUTSIDER,
            _ => {
                return Err(rootcause::Report::new(
                    MacroAuthorizationError::InvalidCredentials,
                ));
            }
        };
        Ok(ValidatedCredential {
            origin: macro_authorization::CredentialOrigin::Session,
            identity: ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                routine_id: None,
                user_id: user.into(),
                fusion_user_id: "fixture".into(),
                organization_id: None,
                permissions: None,
            },
        })
    }
}

fn app(pool: &PgPool) -> Router {
    let state = CrmRouterState {
        service: Arc::new(CrmServiceImpl::new(
            CompaniesRepositoryImpl::new(pool.clone()),
            NoOpCompanyMetadataResolver,
        )),
        stage_service: Arc::new(()),
        entity_access_service: Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            pool.clone(),
        ))),
        authorization_state: MacroAuthorizationState::new(Arc::new(
            MacroAuthorizationServiceImpl::new(
                FixtureCredential,
                InternalAuthConfig {
                    api_key: "fixture-only".into(),
                    default_user_id: None,
                },
                NoBotAuthorizer,
                NoUserApiKeyAuthorizer,
            ),
        )),
    };
    Router::new()
        .route(
            "/crm/companies/{company_id}",
            get(get_company::handler::<_, (), _, _>),
        )
        .route(
            "/crm/companies/{company_id}/contacts/page",
            get(list_company_contacts_page::handler::<_, (), _, _>),
        )
        .with_state(state)
}

async fn get_json(app: &Router, user: &str, uri: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .uri(uri)
        .header("authorization", format!("Bearer {user}"))
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// One Team list page: its contacts' emails and its next cursor, escaped
/// for a query string.
async fn page(
    app: &Router,
    user: &str,
    company_id: Uuid,
    params: &str,
) -> (Vec<String>, Option<String>) {
    let (status, body) = get_json(
        app,
        user,
        &format!("/crm/companies/{company_id}/contacts/page?{params}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{params}: {body}");
    let emails = body["contacts"]
        .as_array()
        .expect("contacts")
        .iter()
        .map(|c| c["email"].as_str().unwrap_or_default().to_string())
        .collect();
    let cursor = body["nextCursor"].as_str().map(|cursor| {
        cursor
            .replace('+', "%2B")
            .replace('/', "%2F")
            .replace('=', "%3D")
    });
    (emails, cursor)
}

/// Adds `user` to the team as a plain member.
async fn add_member(pool: &PgPool, team_id: Uuid, user: &str) -> anyhow::Result<()> {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)"#,
        id,
        user,
        format!("stripe_{id}"),
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user,
        id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')"#,
        team_id,
        user,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// The owner's team with `seed_company`'s company, the owner and a member on
/// it, and an outsider on a team of their own.
async fn seed(pool: &PgPool) -> anyhow::Result<(Uuid, Uuid)> {
    let (team_id, company_id, _) = seed_company(pool).await?;
    sqlx::query!(
        r#"INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner')"#,
        team_id,
        OWNER,
    )
    .execute(pool)
    .await?;
    add_member(pool, team_id, MEMBER).await?;
    seed_team(pool, Uuid::now_v7(), OUTSIDER).await?;
    Ok((team_id, company_id))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn company_read_includes_contacts_unless_asked_not_to(pool: PgPool) -> anyhow::Result<()> {
    let (_, company_id) = seed(&pool).await?;
    let app = app(&pool);
    let contacts = |body: &Value| body["contacts"].as_array().map(Vec::len);

    let (status, default) = get_json(&app, "owner", &format!("/crm/companies/{company_id}")).await;
    assert_eq!(status, StatusCode::OK);
    // The owner sees all eleven, hidden ones included.
    assert_eq!(contacts(&default), Some(11));
    let (_, included) = get_json(
        &app,
        "owner",
        &format!("/crm/companies/{company_id}?includeContacts=true"),
    )
    .await;
    assert_eq!(contacts(&included), Some(11));
    let (_, excluded) = get_json(
        &app,
        "owner",
        &format!("/crm/companies/{company_id}?includeContacts=false"),
    )
    .await;
    assert_eq!(contacts(&excluded), Some(0));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn page_route_defaults_clamps_and_trims(pool: PgPool) -> anyhow::Result<()> {
    let (_, company_id) = seed(&pool).await?;
    // 201 more visible contacts: more than the largest page.
    let ids: Vec<Uuid> = (0..201).map(|_| Uuid::now_v7()).collect();
    sqlx::query!(
        r#"INSERT INTO crm_contacts (id, company_id, email, name, first_interaction, last_interaction)
           SELECT id, $1, 'bulk' || i || '@acme.test', 'Bulk ' || lpad(i::text, 3, '0'), now(), now()
           FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, i)"#,
        company_id,
        &ids,
    )
    .execute(&pool)
    .await?;
    let app = app(&pool);

    // No parameters: 50 visible contacts, and more to come.
    let (emails, cursor) = page(&app, "owner", company_id, "").await;
    assert_eq!(emails.len(), 50);
    assert!(cursor.is_some());
    let (visible, _) = page(&app, "owner", company_id, "archived=false").await;
    assert_eq!(emails, visible);

    // Out-of-range limits are clamped to 1 and 200.
    for limit in ["0", "-5"] {
        let (emails, cursor) = page(&app, "owner", company_id, &format!("limit={limit}")).await;
        assert_eq!(emails.len(), 1, "limit={limit}");
        assert!(cursor.is_some());
    }
    let (emails, cursor) = page(&app, "owner", company_id, "limit=1000").await;
    assert_eq!(emails.len(), 200);
    assert!(cursor.is_some());

    // The search is trimmed.
    let (trimmed, _) = page(&app, "owner", company_id, "query=bulk%201").await;
    let (padded, _) = page(&app, "owner", company_id, "query=%20%20bulk%201%20%20").await;
    assert_eq!(trimmed.len(), 50);
    assert_eq!(padded, trimmed);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn page_route_refuses_cursors_from_another_list(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, company_id) = seed(&pool).await?;
    let other_company = insert_company(&pool, team_id, true, &["other.test"]).await?;
    for i in 0..3 {
        insert_named(
            &pool,
            other_company,
            Some(&format!("anna{i}@other.test")),
            Some("Anna"),
        )
        .await?;
    }
    let app = app(&pool);
    let status = |params: String, company: Uuid| {
        let app = app.clone();
        async move {
            get_json(
                &app,
                "owner",
                &format!("/crm/companies/{company}/contacts/page?{params}"),
            )
            .await
            .0
        }
    };

    assert_eq!(
        status("cursor=not-a-cursor".into(), company_id).await,
        StatusCode::BAD_REQUEST
    );

    let (_, cursor) = page(&app, "owner", company_id, "query=anna&limit=1").await;
    let cursor = cursor.expect("three active Annas make several pages");
    // The same list continues; any other refuses the cursor.
    assert_eq!(
        status(format!("query=anna&limit=2&cursor={cursor}"), company_id).await,
        StatusCode::OK
    );
    assert_eq!(
        status(
            format!("query=%20anna%20&limit=1&cursor={cursor}"),
            company_id
        )
        .await,
        StatusCode::OK
    );
    // An archived list continues with its own cursor.
    let (_, archived) = page(&app, "owner", company_id, "archived=true&limit=1").await;
    let archived = archived.expect("three archived contacts make several pages");
    assert_eq!(
        status(
            format!("archived=true&limit=1&cursor={archived}"),
            company_id
        )
        .await,
        StatusCode::OK
    );
    for (params, company) in [
        (format!("query=anna&limit=1&cursor={cursor}"), other_company),
        (
            format!("archived=true&query=anna&limit=1&cursor={cursor}"),
            company_id,
        ),
        (format!("query=ann&limit=1&cursor={cursor}"), company_id),
        (format!("limit=1&cursor={cursor}"), company_id),
    ] {
        assert_eq!(
            status(params.clone(), company).await,
            StatusCode::BAD_REQUEST,
            "{params} on {company}"
        );
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn page_route_refuses_outsiders_and_hides_archived_rows_from_members(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (_, company_id) = seed(&pool).await?;
    let app = app(&pool);
    let uri = format!("/crm/companies/{company_id}/contacts/page");

    // A member reads the visible list but never the archived contacts.
    let (members_list, _) = page(&app, "member", company_id, "").await;
    assert_eq!(members_list.len(), 8);
    let (archived, _) = page(&app, "member", company_id, "archived=true").await;
    assert!(archived.is_empty());
    let (archived, _) = page(&app, "owner", company_id, "archived=true").await;
    assert_eq!(archived.len(), 3);

    // Someone outside the team is refused.
    assert_eq!(
        get_json(&app, "outsider", &uri).await.0,
        StatusCode::UNAUTHORIZED
    );

    // Once the company is archived, a member is refused; the owner still
    // reads every contact as archived.
    sqlx::query!(
        r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#,
        company_id,
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        get_json(&app, "member", &uri).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        get_json(&app, "member", &format!("{uri}?archived=true"))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (archived, _) = page(&app, "owner", company_id, "archived=true&limit=200").await;
    assert_eq!(archived.len(), 11);
    Ok(())
}
