//! `POST /crm/previews` answers every record as its own read does, for each
//! role on the owning team and for a caller outside it.

use std::sync::Arc;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedCredential,
    ValidatedIdentity,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::{
    domain::{service::CrmServiceImpl, stages::NoOpCrmStageService},
    inbound::axum_router::{CrmRouterState, crm_router},
    outbound::{
        companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
    },
};

const OWNER: &str = "macro|owner@previews.test";
const ADMIN: &str = "macro|admin@previews.test";
const MEMBER: &str = "macro|member@previews.test";
const OUTSIDER: &str = "macro|outsider@previews.test";

/// Accepts the user id itself as the bearer token.
#[derive(Clone)]
struct FixtureCredential;

impl JwtValidator for FixtureCredential {
    fn validate_credential(
        &self,
        token: &str,
    ) -> Result<ValidatedCredential, rootcause::Report<MacroAuthorizationError>> {
        Ok(ValidatedCredential {
            origin: macro_authorization::CredentialOrigin::Session,
            identity: ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                user_id: token.into(),
                fusion_user_id: "fixture".into(),
                organization_id: None,
                permissions: None,
            },
        })
    }
}

fn app(pool: PgPool) -> Router {
    crm_router(CrmRouterState {
        service: Arc::new(CrmServiceImpl::new(
            CompaniesRepositoryImpl::new(pool.clone()),
            NoOpCompanyMetadataResolver,
        )),
        stage_service: Arc::new(NoOpCrmStageService),
        entity_access_service: Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            pool,
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
    })
}

async fn send(app: &Router, user: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let builder = Request::builder()
        .uri(uri)
        .header("authorization", format!("Bearer {user}"));
    let request = match body {
        Some(body) => builder
            .method("POST")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string())),
        None => builder.method("GET").body(Body::empty()),
    }
    .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn ids(values: &[u128]) -> Vec<Uuid> {
    values.iter().copied().map(Uuid::from_u128).collect()
}

fn sorted_by_id(mut previews: Vec<Value>) -> Vec<Value> {
    previews.sort_by_key(|preview| preview["id"].as_str().unwrap_or_default().to_owned());
    previews
}

/// The previews the single reads imply: one per record the read returns,
/// with the fields a chip takes from it.
async fn single_read_previews(
    app: &Router,
    user: &str,
    companies: &[Uuid],
    contacts: &[Uuid],
) -> (Vec<Value>, Vec<Value>) {
    let mut company_previews = Vec::new();
    for id in companies {
        let (status, company) = send(app, user, &format!("/companies/{id}"), None).await;
        if status == StatusCode::OK {
            company_previews.push(json!({
                "id": company["id"],
                "name": company["name"],
                "primaryDomain": company["domains"][0]["domain"],
                "updatedAt": company["updatedAt"],
            }));
        }
    }

    let mut contact_previews = Vec::new();
    for id in contacts {
        let (status, contact) = send(app, user, &format!("/contacts/{id}"), None).await;
        if status == StatusCode::OK {
            contact_previews.push(json!({
                "id": contact["id"],
                "name": contact["name"],
                "email": contact["email"],
                "updatedAt": contact["updatedAt"],
            }));
        }
    }

    (
        sorted_by_id(company_previews),
        sorted_by_id(contact_previews),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn previews_answer_each_record_as_its_own_read(pool: PgPool) {
    let app = app(pool);
    let companies = ids(&[101, 102, 103, 104, 105, 106, 201, 999]);
    let contacts = ids(&[1001, 1002, 1003, 1004, 1005, 2001, 9999]);

    // How many records each caller may open: the hidden company and the
    // hidden contact, and the contact under the hidden company, are the
    // admins' and owner's only.
    let visible = [
        (OWNER, 6, 5),
        (ADMIN, 6, 5),
        (MEMBER, 5, 3),
        (OUTSIDER, 1, 1),
    ];
    for (user, visible_companies, visible_contacts) in visible {
        let (status, previews) = send(
            &app,
            user,
            "/previews",
            Some(json!({ "companyIds": companies, "contactIds": contacts })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{user}");

        let (expected_companies, expected_contacts) =
            single_read_previews(&app, user, &companies, &contacts).await;
        assert_eq!(expected_companies.len(), visible_companies, "{user}");
        assert_eq!(expected_contacts.len(), visible_contacts, "{user}");

        let returned_companies = sorted_by_id(
            previews["companies"]
                .as_array()
                .cloned()
                .unwrap_or_default(),
        );
        let returned_contacts =
            sorted_by_id(previews["contacts"].as_array().cloned().unwrap_or_default());
        assert_eq!(returned_companies, expected_companies, "{user}");
        assert_eq!(returned_contacts, expected_contacts, "{user}");
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn company_titles_fall_back_like_the_company_read(pool: PgPool) {
    let app = app(pool);
    let (_, previews) = send(
        &app,
        MEMBER,
        "/previews",
        Some(json!({ "companyIds": ids(&[101, 102, 103, 104, 105]) })),
    )
    .await;

    let titles: Vec<(Value, Value)> = sorted_by_id(
        previews["companies"]
            .as_array()
            .cloned()
            .unwrap_or_default(),
    )
    .into_iter()
    .map(|preview| (preview["name"].clone(), preview["primaryDomain"].clone()))
    .collect();
    assert_eq!(
        titles,
        [
            (json!("Custom Co"), json!("a.example")),
            (json!("Directory B1"), json!("b1.example")),
            (json!("Directory C"), json!("C.Example")),
            (Value::Null, json!("d.example")),
            (Value::Null, Value::Null),
        ]
    );
    assert_eq!(previews["contacts"], json!([]));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn previews_refuse_more_than_a_hundred_ids_of_a_kind(pool: PgPool) {
    let app = app(pool);
    let too_many: Vec<Uuid> = (0..101).map(|_| Uuid::now_v7()).collect();

    let (status, _) = send(
        &app,
        OWNER,
        "/previews",
        Some(json!({ "contactIds": too_many })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, previews) = send(&app, OWNER, "/previews", Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(previews, json!({ "companies": [], "contacts": [] }));
}
