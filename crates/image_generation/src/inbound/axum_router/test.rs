use super::*;
use crate::domain::models::{ImageAspectRatio, StoredImage};
use ai_billing::{AiAdmissionError, DenyReason};
use axum::body::{Body, to_bytes};
use axum::http::Request;
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use model_owner::CreationPrincipal;
use model_user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use std::sync::Mutex;
use tower::ServiceExt as _;
use uuid::Uuid;

const USER_ID: &str = "macro|painter@example.com";
const STATIC_FILE_ID: Uuid = Uuid::from_u128(0x123);

/// Admits the one token `valid`, as the user above.
#[derive(Clone)]
struct TestAuthorizationService;

impl MacroAuthorizationService for TestAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: USER_ID.to_owned(),
            fusion_user_id: "fusion-painter".to_owned(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt)
            .await
            .map(macro_authorization::ValidatedCredential::session)
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// A canned result for the stub service.
type Outcome = fn() -> Result<StoredGeneratedImage, GenerateImageError>;

/// Records each request and answers with a canned result.
struct StubService {
    result: Outcome,
    requests: Mutex<Vec<(CreationPrincipal, NewGeneratedImage)>>,
}

impl ImageGenerationService for StubService {
    async fn create_generated_image(
        &self,
        principal: &CreationPrincipal,
        image: NewGeneratedImage,
    ) -> Result<StoredGeneratedImage, GenerateImageError> {
        self.requests
            .lock()
            .unwrap()
            .push((principal.clone(), image));
        (self.result)()
    }
}

fn stored() -> Result<StoredGeneratedImage, GenerateImageError> {
    Ok(StoredGeneratedImage {
        markdown: "markup".to_string(),
        static_file: StoredImage {
            id: STATIC_FILE_ID,
            url: "https://static.example/file/123".to_string(),
        },
        mime_type: "image/png".to_string(),
        size_bytes: 2048,
        width: 1024,
        height: 576,
        note: None,
    })
}

fn router(result: Outcome) -> (Router, Arc<StubService>) {
    let service = Arc::new(StubService {
        result,
        requests: Mutex::default(),
    });
    let router = image_generation_router(ImageGenerationRouterState {
        service: service.clone(),
        authorization_state: MacroAuthorizationState::new(Arc::new(TestAuthorizationService)),
        non_user_owners: NonUserOwners::Disabled,
    });
    (router, service)
}

fn request(token: Option<&str>, body: Value) -> Request<Body> {
    let builder = Request::builder()
        .uri("/images/generate")
        .method("POST")
        .header("content-type", "application/json");
    let builder = match token {
        Some(token) => builder.header("authorization", format!("Bearer {token}")),
        None => builder,
    };
    builder.body(Body::from(body.to_string())).unwrap()
}

async fn json_body(response: Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
}

#[tokio::test]
async fn generates_as_the_caller_and_returns_the_stored_image() {
    let (router, service) = router(stored);
    let document = Uuid::from_u128(0x456);
    let response = router
        .oneshot(request(
            Some("valid"),
            json!({
                "prompt": "a lighthouse at dusk",
                "aspectRatio": "widescreen",
                "referenceImages": [
                    {"type": "document", "id": document},
                    {"type": "staticFile", "id": STATIC_FILE_ID},
                ],
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({
            "staticFileId": STATIC_FILE_ID,
            "url": "https://static.example/file/123",
            "mimeType": "image/png",
            "sizeBytes": 2048,
            "width": 1024,
            "height": 576,
        })
    );
    let requests = service.requests.lock().unwrap();
    let [(principal, image)] = requests.as_slice() else {
        panic!("expected one request, got {}", requests.len());
    };
    assert_eq!(
        principal,
        &CreationPrincipal::User(USER_ID.to_string().try_into().unwrap())
    );
    assert_eq!(image.prompt, "a lighthouse at dusk");
    assert_eq!(image.aspect_ratio, Some(ImageAspectRatio::Widescreen));
    assert_eq!(
        image.reference_images,
        [
            ImageReference::Document(document),
            ImageReference::StaticFile(STATIC_FILE_ID),
        ]
    );
}

#[tokio::test]
async fn rejects_unauthenticated_callers_before_generating() {
    let (router, service) = router(stored);
    let response = router
        .oneshot(request(None, json!({"prompt": "a lighthouse"})))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(service.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn rejects_malformed_bodies_with_a_coded_error() {
    let (router, service) = router(stored);
    let response = router
        .oneshot(request(
            Some("valid"),
            json!({"prompt": "a lighthouse", "aspectRatio": "panoramic"}),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json_body(response).await["code"], "invalid_image_request");
    assert!(service.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn maps_domain_failures_to_statuses_and_codes() {
    let cases: [(Outcome, StatusCode, &str); 5] = [
        (
            || {
                Err(GenerateImageError::BadRequest(
                    "prompt must not be empty".to_string(),
                ))
            },
            StatusCode::BAD_REQUEST,
            "invalid_image_request",
        ),
        (
            || Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted).into()),
            StatusCode::PAYMENT_REQUIRED,
            DenyReason::AllowanceExhausted.code(),
        ),
        (
            || Err(ReadImageError::Unauthorized.into()),
            StatusCode::FORBIDDEN,
            "reference_not_accessible",
        ),
        (
            || Err(ImageGenerationError::Refused("unsafe prompt".to_string()).into()),
            StatusCode::UNPROCESSABLE_ENTITY,
            "image_refused",
        ),
        (
            || Err(ImageGenerationError::Provider(anyhow::anyhow!("api key leaked")).into()),
            StatusCode::BAD_GATEWAY,
            "image_provider_error",
        ),
    ];
    for (result, status, code) in cases {
        let (router, _) = router(result);
        let response = router
            .oneshot(request(Some("valid"), json!({"prompt": "a lighthouse"})))
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{code}");
        let body = json_body(response).await;
        assert_eq!(body["code"], code);
        assert!(
            !body["error"].as_str().unwrap().contains("api key"),
            "provider diagnostics must not reach the caller"
        );
    }
}
