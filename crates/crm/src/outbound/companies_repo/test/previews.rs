//! `POST /crm/previews` answers every record as its own read does, for each
//! role on the owning team, for a caller outside it, and for each credential
//! the route takes.

use std::sync::Arc;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, request::Builder},
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use harness_id::HarnessId;
use macro_authorization::{
    AuthorizedUserApiKey, CredentialOrigin, HARNESS_TOKEN_HEADER, HarnessAuthentication,
    HarnessAuthorizationOwner, HarnessAuthorizer, INTERNAL_API_KEY_HEADER,
    INTERNAL_MACRO_USER_ID_HEADER, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, MacroAuthorizationState, MacroUserAuthentication,
    NoBotAuthorizer, USER_API_KEY_HEADER, UserApiKeyAuthorizer, ValidatedCredential,
    ValidatedIdentity,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;
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

pub(super) const OWNER: &str = "macro|owner@previews.test";
const ADMIN: &str = "macro|admin@previews.test";
pub(super) const MEMBER: &str = "macro|member@previews.test";
pub(super) const OUTSIDER: &str = "macro|outsider@previews.test";
const INTERNAL_KEY: &str = "fixture-only";
const HARNESS_TOKEN: &str = "fixture-harness";

/// Accepts the user id itself as the bearer token.
#[derive(Clone)]
struct FixtureCredential;

impl JwtValidator for FixtureCredential {
    fn validate_credential(
        &self,
        token: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        Ok(ValidatedCredential {
            origin: CredentialOrigin::Session,
            identity: ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                routine_id: None,
                user_id: token.into(),
                fusion_user_id: "fixture".into(),
                organization_id: None,
                permissions: None,
            },
        })
    }
}

fn user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_owned(),
        fusion_user_id: "fixture".to_owned(),
        permissions: None,
        organization_id: None,
    }
}

/// Accepts the user id itself as a user API key.
#[derive(Clone)]
struct FixtureApiKey;

impl UserApiKeyAuthorizer for FixtureApiKey {
    async fn authorize_user_api_key(
        &self,
        api_key: &str,
    ) -> Result<AuthorizedUserApiKey, Report<MacroAuthorizationError>> {
        Ok(AuthorizedUserApiKey {
            user_context: user_context(api_key),
            account_manager: None,
        })
    }
}

/// Accepts `HARNESS_TOKEN` as a harness the owner runs.
#[derive(Clone)]
struct FixtureHarness;

impl HarnessAuthorizer for FixtureHarness {
    async fn authorize_harness(
        &self,
        harness_token: &str,
        _acting_user_claim: Option<String>,
    ) -> Result<HarnessAuthentication, Report<MacroAuthorizationError>> {
        if harness_token != HARNESS_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        let harness_id = HarnessId::parse_uuid_str("00000000-0000-0000-0000-0000000000aa")
            .map_err(|_| Report::new(MacroAuthorizationError::InvalidCredentials))?;
        let macro_user_id = MacroUserIdStr::try_from(OWNER.to_owned())
            .map_err(|_| Report::new(MacroAuthorizationError::ActingUserNotAuthorized))?;
        Ok(HarnessAuthentication {
            harness_id,
            token_id: Uuid::nil(),
            owner: HarnessAuthorizationOwner::User {
                user_id: OWNER.to_owned(),
            },
            acting_user: MacroUserAuthentication {
                origin: CredentialOrigin::Harness,
                agent_id: None,
                agent_via: None,
                routine_id: None,
                macro_user_id,
                user_context: user_context(OWNER),
            },
        })
    }
}

pub(super) fn app(pool: PgPool) -> Router {
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
                    api_key: INTERNAL_KEY.into(),
                    default_user_id: None,
                },
                NoBotAuthorizer,
                FixtureApiKey,
            )
            .with_harness_authorizer(FixtureHarness),
        )),
    })
}

/// How a request authenticates.
#[derive(Clone, Copy, Debug)]
enum Caller<'a> {
    /// A session for this user.
    User(&'a str),
    /// The internal key, acting for this user when there is one.
    Internal(Option<&'a str>),
    /// A user API key for this user.
    ApiKey(&'a str),
    /// A harness token, acting for the owner.
    Harness,
}

impl Caller<'_> {
    fn authenticate(self, builder: Builder) -> Builder {
        match self {
            Self::User(user) => builder.header("authorization", format!("Bearer {user}")),
            Self::Internal(user) => {
                let builder = builder.header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY);
                match user {
                    Some(user) => builder.header(INTERNAL_MACRO_USER_ID_HEADER, user),
                    None => builder,
                }
            }
            Self::ApiKey(user) => builder.header(USER_API_KEY_HEADER, user),
            Self::Harness => builder.header(HARNESS_TOKEN_HEADER, HARNESS_TOKEN),
        }
    }
}

async fn send_as(
    app: &Router,
    caller: Caller<'_>,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let builder = caller.authenticate(Request::builder().uri(uri));
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

pub(super) async fn send(
    app: &Router,
    user: &str,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    send_as(app, Caller::User(user), uri, body).await
}

fn ids(values: &[u128]) -> Vec<Uuid> {
    values.iter().copied().map(Uuid::from_u128).collect()
}

fn sorted_by_id(mut previews: Vec<Value>) -> Vec<Value> {
    previews.sort_by_key(|preview| preview["id"].as_str().unwrap_or_default().to_owned());
    previews
}

fn returned(previews: &Value, kind: &str) -> Vec<Value> {
    sorted_by_id(previews[kind].as_array().cloned().unwrap_or_default())
}

/// The previews the single reads imply: one per record the read returns,
/// with the fields a chip takes from it.
async fn single_read_previews(
    app: &Router,
    caller: Caller<'_>,
    companies: &[Uuid],
    contacts: &[Uuid],
) -> (Vec<Value>, Vec<Value>) {
    let mut company_previews = Vec::new();
    for id in companies {
        let (status, company) = send_as(app, caller, &format!("/companies/{id}"), None).await;
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
        let (status, contact) = send_as(app, caller, &format!("/contacts/{id}"), None).await;
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
    let companies = ids(&[101, 102, 103, 104, 105, 106, 107, 201, 999]);
    let contacts = ids(&[1001, 1002, 1003, 1004, 1005, 2001, 9999]);

    // How many records each caller may open: the hidden company and the
    // hidden contact, and the contact under the hidden company, are the
    // admins' and owner's only.
    let visible = [
        (OWNER, 7, 5),
        (ADMIN, 7, 5),
        (MEMBER, 6, 3),
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
            single_read_previews(&app, Caller::User(user), &companies, &contacts).await;
        assert_eq!(expected_companies.len(), visible_companies, "{user}");
        assert_eq!(expected_contacts.len(), visible_contacts, "{user}");
        assert_eq!(
            returned(&previews, "companies"),
            expected_companies,
            "{user}"
        );
        assert_eq!(returned(&previews, "contacts"), expected_contacts, "{user}");
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn previews_and_contact_pages_follow_current_crm_access(pool: PgPool) {
    let app = app(pool.clone());
    let companies = ids(&[101]);
    let contacts = ids(&[1001]);
    let page_uri = format!("/companies/{}/contacts/page", companies[0]);

    for enabled in [true, false, true] {
        sqlx::query!(
            "UPDATE team_user SET crm_access = $1 WHERE user_id = $2",
            enabled,
            MEMBER,
        )
        .execute(&pool)
        .await
        .unwrap();

        for caller in [
            Caller::User(MEMBER),
            Caller::ApiKey(MEMBER),
            Caller::Internal(Some(MEMBER)),
        ] {
            let (status, previews) = send_as(
                &app,
                caller,
                "/previews",
                Some(json!({ "companyIds": companies, "contactIds": contacts })),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{caller:?}");
            let expected = usize::from(enabled);
            assert_eq!(
                returned(&previews, "companies").len(),
                expected,
                "{caller:?}"
            );
            assert_eq!(
                returned(&previews, "contacts").len(),
                expected,
                "{caller:?}"
            );

            let (company_reads, contact_reads) =
                single_read_previews(&app, caller, &companies, &contacts).await;
            assert_eq!(returned(&previews, "companies"), company_reads);
            assert_eq!(returned(&previews, "contacts"), contact_reads);

            let (page_status, page) = send_as(&app, caller, &page_uri, None).await;
            if enabled {
                assert_eq!(page_status, StatusCode::OK);
                assert_eq!(page["contacts"].as_array().unwrap().len(), 1);
            } else {
                assert_eq!(page_status, StatusCode::UNAUTHORIZED);
                assert!(page.get("contacts").is_none());
            }
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn previews_preserve_privileged_access_when_the_stored_preference_is_denied(pool: PgPool) {
    sqlx::query!("UPDATE team_user SET crm_access = false")
        .execute(&pool)
        .await
        .unwrap();
    let app = app(pool);
    let companies = ids(&[101, 106]);
    let contacts = ids(&[1001, 1002, 1003]);
    for user in [ADMIN, OWNER] {
        let (status, previews) = send(
            &app,
            user,
            "/previews",
            Some(json!({ "companyIds": companies, "contactIds": contacts })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(returned(&previews, "companies").len(), 2);
        assert_eq!(returned(&previews, "contacts").len(), 3);
        let (expected_companies, expected_contacts) =
            single_read_previews(&app, Caller::User(user), &companies, &contacts).await;
        assert_eq!(returned(&previews, "companies"), expected_companies);
        assert_eq!(returned(&previews, "contacts"), expected_contacts);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn internal_and_api_key_callers_see_what_their_user_reads(pool: PgPool) {
    let app = app(pool);
    let companies = ids(&[101, 102, 103, 104, 105, 106, 107, 201, 999]);
    let contacts = ids(&[1001, 1002, 1003, 1004, 1005, 2001, 9999]);
    let (member_companies, member_contacts) =
        single_read_previews(&app, Caller::User(MEMBER), &companies, &contacts).await;
    assert_eq!((member_companies.len(), member_contacts.len()), (6, 3));

    for caller in [Caller::Internal(Some(MEMBER)), Caller::ApiKey(MEMBER)] {
        let (status, previews) = send_as(
            &app,
            caller,
            "/previews",
            Some(json!({ "companyIds": companies, "contactIds": contacts })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{caller:?}");

        let (expected_companies, expected_contacts) =
            single_read_previews(&app, caller, &companies, &contacts).await;
        assert_eq!(expected_companies, member_companies, "{caller:?}");
        assert_eq!(expected_contacts, member_contacts, "{caller:?}");
        assert_eq!(
            returned(&previews, "companies"),
            expected_companies,
            "{caller:?}"
        );
        assert_eq!(
            returned(&previews, "contacts"),
            expected_contacts,
            "{caller:?}"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn previews_refuse_callers_the_reads_refuse(pool: PgPool) {
    let app = app(pool);
    let body = json!({ "companyIds": ids(&[101]), "contactIds": ids(&[1001]) });

    // An internal service must name the user it acts for; a harness token
    // acts for its owner but is not a credential this route takes.
    for (caller, refused) in [
        (Caller::Internal(None), StatusCode::UNAUTHORIZED),
        (Caller::Harness, StatusCode::FORBIDDEN),
    ] {
        let (status, _) = send_as(&app, caller, "/previews", Some(body.clone())).await;
        assert_eq!(status, refused, "{caller:?}");
        let (single, _) = send_as(
            &app,
            caller,
            "/companies/00000000-0000-0000-0000-000000000065",
            None,
        )
        .await;
        assert!(single.is_client_error(), "{caller:?}: {single}");
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

    let titles: Vec<(Value, Value)> = returned(&previews, "companies")
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
async fn domains_created_together_title_the_chip_as_the_company_read(pool: PgPool) {
    let app = app(pool);
    let company = ids(&[107]);

    let (_, previews) = send(
        &app,
        MEMBER,
        "/previews",
        Some(json!({ "companyIds": company })),
    )
    .await;
    let (expected, _) = single_read_previews(&app, Caller::User(MEMBER), &company, &[]).await;

    // Both read the lower id first, though the higher one went in first.
    assert_eq!(returned(&previews, "companies"), expected);
    assert_eq!(expected[0]["name"], json!("Directory T1"));
    assert_eq!(expected[0]["primaryDomain"], json!("t1.example"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn previews_answer_a_repeated_id_once(pool: PgPool) {
    let app = app(pool);

    let (status, previews) = send(
        &app,
        MEMBER,
        "/previews",
        Some(json!({
            "companyIds": ids(&[101, 101, 102, 101]),
            "contactIds": ids(&[1001, 1001]),
        })),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let (companies, contacts) =
        single_read_previews(&app, Caller::User(MEMBER), &ids(&[101, 102]), &ids(&[1001])).await;
    assert_eq!(returned(&previews, "companies"), companies);
    assert_eq!(returned(&previews, "contacts"), contacts);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn previews_take_at_most_a_hundred_ids_of_each_kind(pool: PgPool) {
    let app = app(pool);
    let with_unknown = |known: &[u128], count: usize| -> Vec<Uuid> {
        let mut values = ids(known);
        values.extend((values.len()..count).map(|_| Uuid::now_v7()));
        values
    };
    let companies = with_unknown(&[101, 102, 103, 104, 105], 100);
    let contacts = with_unknown(&[1001, 1004, 1005], 100);

    let (status, previews) = send(
        &app,
        MEMBER,
        "/previews",
        Some(json!({ "companyIds": companies, "contactIds": contacts })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(returned(&previews, "companies").len(), 5);
    assert_eq!(returned(&previews, "contacts").len(), 3);

    let mut too_many = companies.clone();
    too_many.push(Uuid::now_v7());
    // The cap counts ids as sent, repeats included.
    let mut repeated = companies.clone();
    repeated.push(companies[0]);
    for body in [
        json!({ "companyIds": too_many }),
        json!({ "contactIds": too_many }),
        json!({ "companyIds": repeated, "contactIds": contacts }),
    ] {
        let (status, _) = send(&app, OWNER, "/previews", Some(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    let (status, previews) = send(&app, OWNER, "/previews", Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(previews, json!({ "companies": [], "contacts": [] }));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("fixtures/previews.sql"))]
async fn previews_refuse_an_id_that_is_not_a_uuid(pool: PgPool) {
    let app = app(pool);
    let valid = Uuid::from_u128(101);

    for body in [
        json!({ "companyIds": ["not-a-uuid"] }),
        json!({ "contactIds": [""] }),
        json!({ "companyIds": [valid, "not-a-uuid"], "contactIds": ids(&[1001]) }),
        json!({ "companyIds": [valid], "contactIds": [Uuid::from_u128(1001), 7] }),
    ] {
        let (status, _) = send(&app, MEMBER, "/previews", Some(body.clone())).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }

    // A body that is not JSON at all is a bad request.
    let request = Request::builder()
        .method("POST")
        .uri("/previews")
        .header("authorization", format!("Bearer {MEMBER}"))
        .header("content-type", "application/json")
        .body(Body::from("{"))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
