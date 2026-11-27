//! Test-only HTTP composition for the isolated signed Team Passwords app.
use crate::{
    domain::service::PasswordService,
    inbound::router::{PasswordRouterState, local_signed_item_router},
    outbound::{
        availability::{LocalPasswordsFlags, PasswordAvailability},
        openbao::OpenBaoProvider,
        postgres::PgRepository,
    },
};
use axum::{
    Router,
    extract::{Request, State},
    http::{Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedCredential,
};
use model_user::UserContext;
use rootcause::Report;
use serde::Deserialize;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    net::SocketAddr,
    os::unix::fs::{FileTypeExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::net::TcpListener;
use uuid::Uuid;
use zeroize::Zeroizing;

const TEAM: &str = "0193a1b2-0000-7000-8000-0000000000aa";
const SESSION_ISSUER: &str = "macrobots-hire-review.local.test";
const OPENBAO_ISSUER: &str = "macro-bots-signed-storage-proof";

#[derive(Deserialize)]
struct SessionClaims {
    tid: String,
    macro_user_id: String,
    fusion_user_id: String,
    macro_organization_id: Option<i32>,
    root_macro_id: Option<String>,
}

#[derive(Clone)]
struct FixtureVerifier {
    key: DecodingKey,
    validation: Validation,
    tenant: String,
    humans: [String; 2],
}

impl FixtureVerifier {
    fn from_private_launcher() -> Self {
        let audience = required("BOTS_VAULT_AUTH_AUDIENCE");
        let mut validation = Validation::new(Algorithm::HS256);
        validation.set_issuer(&[SESSION_ISSUER]);
        validation.set_audience(&[&audience]);
        validation.set_required_spec_claims(&["iss", "aud", "exp"]);
        validation.leeway = 0;
        let humans = [
            required("BOTS_VAULT_AA_HUMAN"),
            required("BOTS_VAULT_BB_HUMAN"),
        ];
        assert!(
            humans[0] != humans[1],
            "fixture human identities must differ"
        );
        let key = Zeroizing::new(required("BOTS_VAULT_AUTH_KEY"));
        Self {
            key: DecodingKey::from_secret(key.as_bytes()),
            validation,
            tenant: required("BOTS_VAULT_AUTH_TENANT"),
            humans,
        }
    }
}

impl JwtValidator for FixtureVerifier {
    fn validate_credential(
        &self,
        bearer: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        let claims = decode::<SessionClaims>(bearer, &self.key, &self.validation)
            .map_err(|_| Report::new(MacroAuthorizationError::InvalidCredentials))?
            .claims;
        if claims.tid != self.tenant || !self.humans.contains(&claims.macro_user_id) {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(ValidatedCredential::session(UserContext {
            user_id: claims.macro_user_id,
            fusion_user_id: claims.root_macro_id.unwrap_or(claims.fusion_user_id),
            permissions: None,
            organization_id: claims.macro_organization_id,
        }))
    }
}

fn required(name: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| panic!("missing private launcher field {name}"))
}

async fn fixture_scope(
    State(address): State<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let host = address.to_string();
    let request_host = request
        .headers()
        .get(header::HOST)
        .and_then(|host| host.to_str().ok());
    if request_host != Some(host.as_str())
        || request.uri().query().is_some()
        || request.uri().path().split('/').nth(3) != Some(TEAM)
        || !matches!(
            *request.method(),
            Method::GET | Method::POST | Method::PUT | Method::PATCH
        )
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    next.run(request).await
}

fn bind_fixture_scope(app: Router, address: SocketAddr) -> Router {
    Router::new()
        .nest("/passwords", app)
        .layer(axum::middleware::from_fn_with_state(address, fixture_scope))
}

/// Local runner only. It serves the reviewed AA item routes with the original
/// second-issuer bearer and live synthetic team's database authorization.
#[tokio::test]
#[ignore = "requires the isolated AA/BB issuer, no-network fixture DB and private OpenBao"]
async fn serve_signed_team_passwords_fixture() {
    let fixture_dir = PathBuf::from(required("BOTS_VAULT_STORAGE_DIR"));
    assert!(
        fixture_dir.parent() == Some(Path::new("/tmp"))
            && fixture_dir
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("bots-vault-storage."))
            && fs::symlink_metadata(&fixture_dir).is_ok_and(
                |metadata| metadata.is_dir() && metadata.permissions().mode() & 0o077 == 0
            )
    );
    let socket = PathBuf::from(required("BOTS_VAULT_PG_SOCKET"));
    assert!(
        socket.parent() == Some(Path::new("/tmp"))
            && socket
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("macro-hire-local."))
            && socket.canonicalize().is_ok_and(|actual| actual == socket)
            && fs::symlink_metadata(&socket).is_ok_and(|metadata| {
                metadata.is_dir() && metadata.permissions().mode() & 0o077 == 0
            })
            && fs::symlink_metadata(socket.join(".s.PGSQL.5432"))
                .is_ok_and(|metadata| metadata.file_type().is_socket())
    );
    let verification = FixtureVerifier::from_private_launcher();
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .connect_with(
            PgConnectOptions::new()
                .socket(socket)
                .port(5432)
                .username(&required("BOTS_VAULT_DB_ROLE"))
                .database("bots_hire_review"),
        )
        .await
        .expect("isolated review database");
    let provider_origin =
        fs::read_to_string(fixture_dir.join("openbao-loopback")).expect("fixture OpenBao address");
    let provider_origin: SocketAddr = provider_origin.trim().parse().expect("loopback address");
    assert!(provider_origin.ip() == std::net::Ipv4Addr::LOCALHOST && provider_origin.port() != 0);
    let origin = format!("http://{provider_origin}");
    let provider = {
        let key = Zeroizing::new(
            fs::read_to_string(fixture_dir.join("vault-private.pem")).expect("fixture OpenBao key"),
        );
        OpenBaoProvider::new(origin, OPENBAO_ISSUER.into(), &key).expect("fixture provider")
    };

    let service = Arc::new(PasswordService {
        repository: Arc::new(PgRepository::new(pool).expect("fixture repository")),
        provider: Arc::new(provider),
        availability: Arc::new(PasswordAvailability {
            flags: LocalPasswordsFlags,
            provider_configured: true,
        }),
    });
    let authorization = MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        verification,
        InternalAuthConfig {
            api_key: Uuid::new_v4().to_string(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    )));

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("fixture listener");
    let address = listener.local_addr().expect("fixture listener address");
    let app = bind_fixture_scope(
        local_signed_item_router(PasswordRouterState {
            service,
            authorization,
        }),
        address,
    );
    let mut ready = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(fixture_dir.join("storage-origin"))
        .expect("write new private storage origin");
    writeln!(ready, "http://{address}").expect("record private storage origin");
    if let Ok(result) = tokio::time::timeout(Duration::from_secs(20 * 60), async {
        axum::serve(listener, app).await
    })
    .await
    {
        result.expect("serve fixture routes");
    }
}

#[tokio::test]
async fn signed_storage_accepts_only_the_exact_fixture_scope() {
    use axum::{body::Body, routing::get};
    use tower::ServiceExt;

    let address = SocketAddr::from(([127, 0, 0, 1], 41234));
    let app = bind_fixture_scope(
        Router::new().route("/teams/{team}/items", get(|| async { StatusCode::OK })),
        address,
    );
    let catalog = format!("/passwords/teams/{TEAM}/items");
    let wrong_team = catalog.replace(TEAM, "0193a1b2-0000-7000-8000-0000000000bb");
    let query = format!("{catalog}?search=any");
    for (method, path, host, expected) in [
        (
            Method::GET,
            catalog.as_str(),
            "127.0.0.1:41234",
            StatusCode::OK,
        ),
        (
            Method::GET,
            wrong_team.as_str(),
            "127.0.0.1:41234",
            StatusCode::NOT_FOUND,
        ),
        (
            Method::GET,
            query.as_str(),
            "127.0.0.1:41234",
            StatusCode::NOT_FOUND,
        ),
        (
            Method::HEAD,
            catalog.as_str(),
            "127.0.0.1:41234",
            StatusCode::NOT_FOUND,
        ),
        (
            Method::GET,
            catalog.as_str(),
            "localhost:41234",
            StatusCode::NOT_FOUND,
        ),
    ] {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, host)
            .body(Body::empty())
            .expect("fixture scope request");
        let response = app
            .clone()
            .oneshot(request)
            .await
            .expect("fixture scope response");
        assert_eq!(response.status(), expected);
    }
}
