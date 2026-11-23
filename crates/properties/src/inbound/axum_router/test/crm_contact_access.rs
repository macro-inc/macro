//! Contact properties through the real HTTP routes, CRM access checks and storage.
use super::*;
use crate::{PermissionServiceImpl, PropertiesPgRepo};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const OWNER: &str = "macro|owner@example.com";
const EDITOR: &str = "macro|editor@example.com";
const DENIED: &str = "macro|denied@example.com";
const OUTSIDER: &str = "macro|outsider@example.com";
const PHONE: &str = "+1 555 0100";

#[derive(Clone, Copy)]
struct TokenIsUser;

impl JwtValidator for TokenIsUser {
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        Ok(macro_authorization::ValidatedCredential {
            origin: macro_authorization::CredentialOrigin::Session,
            identity: ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                routine_id: None,
                user_id: jwt.to_string(),
                fusion_user_id: format!("fusion-{jwt}"),
                organization_id: None,
                permissions: None,
            },
        })
    }
}

async fn insert_user(pool: &PgPool, user_id: &str) -> sqlx::Result<()> {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        macro_user_id,
        user_id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user_id,
        macro_user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_contact(pool: &PgPool, team_id: Uuid, hidden: bool) -> sqlx::Result<Uuid> {
    let contact_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO crm_contacts (id, team_id, name, hidden, first_interaction, last_interaction)
         VALUES ($1, $2, 'Ada', $3, now(), now())",
        contact_id,
        team_id,
        hidden,
    )
    .execute(pool)
    .await?;
    Ok(contact_id)
}

fn contact_router(pool: &PgPool) -> Router {
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let service = PropertiesServiceImpl::new(
        PropertiesPgRepo::new(pool.clone()),
        Some(PermissionServiceImpl::new(pool.clone(), access.clone())),
        None::<MockNotificationService>,
    );
    let authorization = MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        TokenIsUser,
        InternalAuthConfig {
            api_key: INTERNAL_API_KEY.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
        macro_authorization::NoUserApiKeyAuthorizer,
    )));
    super::super::router().with_state(PropertiesRouterState::new(
        Arc::new(service),
        access,
        authorization,
    ))
}

async fn set_phone(
    app: &Router,
    user: &str,
    contact_id: Uuid,
    phone_id: Uuid,
    value: serde_json::Value,
) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/entities/CONTACT/{contact_id}/{phone_id}"))
                .header(header::AUTHORIZATION, format!("Bearer {user}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::json!({ "value": value }).to_string(),
                ))
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond")
        .status()
}

/// The status and the Phone value a caller reads back, if any.
async fn read_phone(
    app: &Router,
    user: &str,
    contact_id: Uuid,
    phone_id: Uuid,
) -> (StatusCode, Option<serde_json::Value>) {
    let response = app
        .clone()
        .oneshot(bearer_request(
            &format!("/entities/CONTACT/{contact_id}"),
            user,
        ))
        .await
        .expect("router should respond");
    let status = response.status();
    let body = response_body(response).await;
    if status != StatusCode::OK {
        assert!(!body.contains(PHONE), "a refused read leaked the value");
        return (status, None);
    }
    let body: serde_json::Value = serde_json::from_str(&body).expect("JSON body");
    let phone = body["properties"]
        .as_array()
        .expect("properties list")
        .iter()
        .find(|property| property["definition"]["id"] == phone_id.to_string())
        .map(|property| property["value"].clone());
    (status, phone)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn contact_properties_follow_crm_record_access(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    for user in [OWNER, EDITOR, DENIED, OUTSIDER] {
        insert_user(&pool, user).await?;
    }
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Sales', $2)",
        team_id,
        OWNER,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role, crm_access)
         VALUES ($1, $2, 'owner', true), ($1, $3, 'member', true), ($1, $4, 'member', false)",
        team_id,
        OWNER,
        EDITOR,
        DENIED,
    )
    .execute(&pool)
    .await?;
    let phone_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO property_definitions (id, team_id, display_name, data_type, is_multi_select)
         VALUES ($1, $2, 'Phone', 'STRING', false)",
        phone_id,
        team_id,
    )
    .execute(&pool)
    .await?;
    let contact = insert_contact(&pool, team_id, false).await?;
    let archived = insert_contact(&pool, team_id, true).await?;
    let app = contact_router(&pool);
    let phone = serde_json::json!({ "type": "string", "value": PHONE });

    // A member with CRM access edits a visible contact and reads it back.
    assert_eq!(
        set_phone(&app, EDITOR, contact, phone_id, phone.clone()).await,
        StatusCode::NO_CONTENT
    );
    let (status, value) = read_phone(&app, EDITOR, contact, phone_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(value.expect("Phone is attached")["value"], PHONE);

    // A member without CRM access, and someone outside the team, neither
    // read nor write it.
    for user in [DENIED, OUTSIDER] {
        assert_eq!(
            read_phone(&app, user, contact, phone_id).await,
            (StatusCode::FORBIDDEN, None),
            "{user}"
        );
        assert_eq!(
            set_phone(
                &app,
                user,
                contact,
                phone_id,
                serde_json::json!({ "type": "string", "value": "overwritten" }),
            )
            .await,
            StatusCode::FORBIDDEN,
            "{user}"
        );
    }
    let (_, value) = read_phone(&app, EDITOR, contact, phone_id).await;
    assert_eq!(value.expect("Phone is attached")["value"], PHONE);

    // An archived contact is out of a member's reach; the owner still edits it.
    assert_eq!(
        set_phone(&app, EDITOR, archived, phone_id, phone.clone()).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        read_phone(&app, EDITOR, archived, phone_id).await,
        (StatusCode::FORBIDDEN, None)
    );
    assert_eq!(
        set_phone(&app, OWNER, archived, phone_id, phone).await,
        StatusCode::NO_CONTENT
    );

    // Clearing keeps the property attached without a value.
    assert_eq!(
        set_phone(&app, EDITOR, contact, phone_id, serde_json::Value::Null).await,
        StatusCode::NO_CONTENT
    );
    let (_, value) = read_phone(&app, EDITOR, contact, phone_id).await;
    assert_eq!(value, Some(serde_json::Value::Null));
    Ok(())
}
