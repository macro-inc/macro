use std::sync::{Arc, Mutex};

use authentication_service::service::google_grant::{
    CreateGrantOutcome, GoogleGrant, GoogleGrantClient, GoogleGrantService,
};
use calendar_events::{domain::service::CalendarService, outbound::pg::PgCalendarRepository};
use email_api_client::{
    GmailApiClientRepository,
    domain::{
        models::{AccessToken, TokenError, TokenFreshness},
        ports::{AlwaysAllowRateLimiter, ProviderTokenSource},
        service::EmailApiClientServiceImpl,
    },
};
use email_service::{inbox_owner::InboxOwnerService, outbound::inbox_owner::PgInboxOwners};
use macro_event_broker::NoopMacroEventBroker;
use rootcause::Report;
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

use super::*;

const MAILBOX: &str = "secondary@example.com";
const SUBJECT: &str = "verified-google-subject";
const GMAIL_SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";
const OWNER_ID: &str = "01900000-0000-7000-8000-000000000001";
const REQUESTER_ID: &str = "01900000-0000-7000-8000-000000000002";

/// External identity storage persists across failed init and fresh consent.
/// Both the production grant service and init's token port use the same state.
#[derive(Clone, Default)]
struct GoogleIdentity(Arc<Mutex<Option<(Uuid, String)>>>);

impl GoogleGrantClient for GoogleIdentity {
    async fn create(&self, grant: &GoogleGrant<'_>) -> Result<CreateGrantOutcome, Report> {
        assert_eq!(grant.subject, SUBJECT);
        assert_eq!(grant.email, MAILBOX);
        let mut identity = self.0.lock().unwrap();
        if identity.is_some() {
            return Ok(CreateGrantOutcome::AlreadyLinked);
        }
        *identity = Some((grant.preferred_owner, grant.refresh_token.to_string()));
        Ok(CreateGrantOutcome::Created)
    }

    async fn owner(&self, grant: &GoogleGrant<'_>) -> Result<Option<Uuid>, Report> {
        assert_eq!(grant.subject, SUBJECT);
        Ok(self.0.lock().unwrap().as_ref().map(|(owner, _)| *owner))
    }

    async fn refresh(&self, grant: &GoogleGrant<'_>, owner: Uuid) -> Result<(), Report> {
        let mut identity = self.0.lock().unwrap();
        let (stored_owner, token) = identity.as_mut().unwrap();
        assert_eq!(
            *stored_owner, owner,
            "reconsent must preserve Google ownership"
        );
        *token = grant.refresh_token.to_string();
        Ok(())
    }
}

impl ProviderTokenSource for GoogleIdentity {
    async fn get_access_token(
        &self,
        _: Uuid,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        panic!("explicit consent must not use token-scope discovery")
    }

    async fn get_access_token_for_link(
        &self,
        link: &Link,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        let identity = self.0.lock().unwrap();
        let (owner, token) = identity.as_ref().unwrap();
        assert_eq!(link.fusionauth_user_id, owner.to_string());
        assert_eq!(link.email_address.0.as_ref(), MAILBOX);
        Ok(AccessToken::new(token.clone()))
    }

    async fn get_access_token_health_neutral(
        &self,
        _: &Link,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        panic!("connecting must not tear down the identity")
    }
}

type RecoveryContext = InitContext<GoogleIdentity, AlwaysAllowRateLimiter, NoopMacroEventBroker>;

fn caller(email: &str, id: Uuid) -> MacroUserAuthentication {
    let mut user = MacroUserAuthentication {
        macro_user_id: MacroUserIdStr::try_from(format!("macro|{email}")).unwrap(),
        user_context: Default::default(),
    };
    user.user_context.user_id = user.macro_user_id.to_string();
    user.user_context.fusion_user_id = id.to_string();
    user
}

/// Starts at the verified-consent boundary. The real grant service resolves and
/// persists the identity; the normal pending record carries its result to init.
async fn consent(
    pool: &PgPool,
    google: &GoogleGrantService<GoogleIdentity>,
    requester: Uuid,
    token: &str,
) -> Uuid {
    let scopes = vec!["openid".to_string(), GMAIL_SCOPE.to_string()];
    let pending = macro_db_client::in_progress_user_link::create_in_progress_google_link(
        pool,
        &requester.to_string(),
        &scopes,
    )
    .await
    .unwrap();
    let owner = google
        .connect(GoogleGrant {
            identity_provider_id: "google-gmail",
            subject: SUBJECT,
            email: MAILBOX,
            refresh_token: token,
            preferred_owner: requester,
        })
        .await
        .unwrap();
    macro_db_client::in_progress_user_link::set_linked_google_grant(
        pool, &pending, MAILBOX, &scopes, owner,
    )
    .await
    .unwrap();
    pending
}

async fn initialize(
    ctx: &RecoveryContext,
    pending: Uuid,
    user: MacroUserAuthentication,
) -> Result<Response, InitError> {
    complete_init(
        ctx,
        Query(InitParams {
            link_id: Some(pending),
            force_share: false,
        }),
        user,
    )
    .await
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../outbound/inbox_owner", scripts("fixture"))
)]
async fn fresh_consent_recovers_failed_init_without_moving_identity_or_sharing_other_mailboxes(
    pool: PgPool,
) {
    let owner = Uuid::parse_str(OWNER_ID).unwrap();
    let requester = Uuid::parse_str(REQUESTER_ID).unwrap();
    let google = GoogleGrantService {
        client: GoogleIdentity::default(),
    };
    let gmail = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/watch"))
        .respond_with(ResponseTemplate::new(503))
        .with_priority(1)
        .up_to_n_times(1)
        .expect(1)
        .mount(&gmail)
        .await;
    Mock::given(method("POST"))
        .and(path("/users/me/watch"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "historyId": "12345", "expiration": "1893456000000"
        })))
        .with_priority(2)
        .expect(1)
        .mount(&gmail)
        .await;

    let queue = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "MessageId": "backfill-message"
        })))
        .expect(1)
        .mount(&queue)
        .await;
    let aws = macro_aws_config::local_aws_config(&queue.uri()).await;
    let sqs = sqs_client::SQS::new(aws_sdk_sqs::Client::new(&aws))
        .email_backfill_queue(&format!("{}/000000000000/backfill", queue.uri()));
    let ctx = RecoveryContext {
        db: pool.clone(),
        inbox_owners: InboxOwnerService {
            repo: PgInboxOwners(pool.clone()),
        },
        // Any accidental shared-mailbox promotion hits an unmatched mock route.
        auth_service_client: Arc::new(authentication_service_client::AuthServiceClient::new(
            "test-key".into(),
            gmail.uri(),
        )),
        email_api: EmailApiClientServiceImpl::new(
            GmailApiClientRepository::new(gmail_client::GmailClient::new_with_urls(
                "projects/test/topics/mail".into(),
                gmail.uri(),
                gmail.uri(),
                gmail.uri(),
                "test".into(),
            )),
            google.client.clone(),
            AlwaysAllowRateLimiter,
        ),
        sqs_client: Arc::new(sqs),
        macro_event_broker: Arc::new(NoopMacroEventBroker),
        calendar_service: Arc::new(CalendarService::new(PgCalendarRepository::new(
            pool.clone(),
        ))),
    };

    let failed = consent(&pool, &google, owner, "first-consent").await;
    let error = initialize(&ctx, failed, caller("older@example.com", owner))
        .await
        .unwrap_err();
    assert_eq!(error.status_code(), StatusCode::INTERNAL_SERVER_ERROR);
    assert!(matches!(
        error,
        InitError::ProviderError(EmailApiError::Transient { .. })
    ));
    // Normal failure cleanup consumes this attempt; retry requires fresh OAuth.
    assert!(
        macro_db_client::in_progress_user_link::get_in_progress_user_link(&pool, &failed)
            .await
            .is_err()
    );
    assert_eq!(google.client.0.lock().unwrap().as_ref().unwrap().0, owner);
    assert!(
        email_db_client::links::get::fetch_link_by_email(&pool, MAILBOX, link::UserProvider::Gmail)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        email_db_client::links::get::fetch_inboxes_for_macro_id(
            &pool,
            "macro|requester@example.com"
        )
        .await
        .unwrap()
        .is_empty()
    );

    // A different Macro account retries the same Google mailbox. There is still
    // no Macro profile for MAILBOX, so the persisted grant owner is essential.
    let retry = consent(&pool, &google, requester, "second-consent").await;
    assert_ne!(retry, failed);
    let response = initialize(&ctx, retry, caller("requester@example.com", requester))
        .await
        .unwrap();
    let initialized: InitResponse = serde_json::from_value(body_json(response).await).unwrap();
    assert!(initialized.backfill_job_id.is_some());
    assert!(
        macro_db_client::in_progress_user_link::get_in_progress_user_link(&pool, &retry)
            .await
            .is_err()
    );

    // Reconnecting the now-delegated mailbox must reuse it, without moving the
    // Google identity, creating a shared stub, or starting another backfill.
    let reconnect = consent(&pool, &google, requester, "third-consent").await;
    let response = initialize(&ctx, reconnect, caller("requester@example.com", requester))
        .await
        .unwrap();
    let reconnected: InitResponse = serde_json::from_value(body_json(response).await).unwrap();
    assert_eq!(reconnected.link_id, initialized.link_id);
    assert!(reconnected.backfill_job_id.is_none());
    assert_eq!(
        *google.client.0.lock().unwrap(),
        Some((owner, "third-consent".to_string()))
    );
    assert!(
        macro_db_client::user::get::get_macro_user_id_by_email(&pool, MAILBOX)
            .await
            .unwrap()
            .is_none()
    );

    let accessible = email_db_client::links::get::fetch_inboxes_for_macro_id(
        &pool,
        "macro|requester@example.com",
    )
    .await
    .unwrap();
    assert_eq!(accessible.len(), 1);
    assert_eq!(accessible[0].id, initialized.link_id);
    assert_eq!(accessible[0].email_address.0.as_ref(), MAILBOX);
    assert_eq!(accessible[0].fusionauth_user_id, owner.to_string());
    assert_eq!(accessible[0].macro_id.as_ref(), "macro|older@example.com");
    let owners_inboxes =
        email_db_client::links::get::fetch_inboxes_for_macro_id(&pool, "macro|older@example.com")
            .await
            .unwrap();
    assert_eq!(
        owners_inboxes.len(),
        2,
        "the owner's unrelated inbox remains private"
    );
    let delegates = macro_db_client::macro_user_links::get_primaries_for_link(
        &pool,
        "macro|older@example.com",
        initialized.link_id,
    )
    .await
    .unwrap();
    assert_eq!(delegates, vec!["macro|requester@example.com"]);
    let job =
        email_db_client::backfill::job::get::get_active_backfill_job(&pool, initialized.link_id)
            .await
            .unwrap()
            .unwrap();
    assert_eq!(Some(job.id), initialized.backfill_job_id);
    assert_eq!(job.fusionauth_user_id, owner.to_string());
}
