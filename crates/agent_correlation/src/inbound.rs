//! Optional attribution extraction and request-scoped propagation.

use crate::{
    context::{Attribution, SharingRefused},
    domain::{Correlation, CorrelationError, CorrelationRepository, validate},
    scope::{OwnSession, SessionScope, SignedScope},
};
use axum::{
    Json,
    extract::{FromRef, FromRequestParts, Request, State},
    http::{StatusCode, request::Parts},
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_auth::{
    credential::CredentialKind,
    macro_api_token::MacroApiToken,
    middleware::decode_jwt::{JwtToken, JwtValidationArgs},
};
use serde::Serialize;
use std::sync::Arc;
use tracing::Instrument;
use uuid::Uuid;

/// Resources used exclusively for verifying optional attribution.
#[derive(Clone)]
pub struct CorrelationState {
    /// Existing JWT verifier configuration.
    pub jwt: JwtValidationArgs,
    /// Primary-database mapping lookup.
    pub repository: Arc<dyn CorrelationRepository>,
    /// The OpenAPI specs (as `packages/sdk/specs` names them) this service
    /// serves, so a background job's list entries count only here
    /// ([`SessionScope::allows_on`]); `None` binds them to no service.
    pub specs: Option<&'static [&'static str]>,
}

impl CorrelationState {
    /// The same state, serving `specs`.
    pub fn serving(self, specs: &'static [&'static str]) -> Self {
        Self {
            specs: Some(specs),
            ..self
        }
    }
}

#[cfg(feature = "postgres")]
impl CorrelationState {
    /// Compose attribution validation from an existing primary pool and verifier.
    pub fn new(pool: sqlx::PgPool, jwt: JwtValidationArgs) -> Self {
        Self {
            jwt,
            repository: Arc::new(crate::outbound::PgCorrelationRepository(pool)),
            specs: None,
        }
    }
}

/// Optional signed invocation attribution. It grants no authorization.
pub struct AgentCorrelationExtractor(pub Option<Uuid>, pub Option<crate::AgentVerb>);

impl<S: Send + Sync> FromRequestParts<S> for AgentCorrelationExtractor
where
    CorrelationState: FromRef<S>,
{
    type Rejection = CorrelationRejection;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = CorrelationState::from_ref(state);
        let tokens = verified_api_tokens(parts, &state.jwt)?;
        other_tokens_scope(Some(&state), state.specs, &tokens.others, parts).await?;
        let token = tokens.authenticating;
        let signed = checked_signed_scope(token.as_ref(), parts, state.specs)?;
        let correlation = accept_correlation(&state, token.as_ref()).await?;
        if !within_own_session(signed, correlation.map(|(_, c)| c), state.specs, parts) {
            return Err(CorrelationRejection(CorrelationError::OutOfScope));
        }
        let id = correlation.map(|(id, _)| id);
        Ok(Self(id, id.and_then(|_| sdk_verb(parts))))
    }
}

/// The request's Macro API tokens whose signatures verify, as
/// [`macro_auth::credential::request_credential`] reads them: the one the
/// request authenticates with, if it is one, and every other the request
/// carries. A request is held to every scope any of them is in, so sending
/// an unscoped token beside a scoped one gains nothing. Tokens of different
/// users, or credentials that can't be told apart, are refused.
struct VerifiedTokens {
    authenticating: Option<MacroApiToken>,
    others: Vec<MacroApiToken>,
}

fn verified_api_tokens(
    parts: &mut Parts,
    jwt: &JwtValidationArgs,
) -> Result<VerifiedTokens, CorrelationRejection> {
    let credential = macro_auth::credential::request_credential(parts)
        .map_err(|_| CorrelationRejection(CorrelationError::ConflictingCredentials))?;
    let authenticating_token = match &credential.kind {
        CredentialKind::UserToken { token, .. } => Some(token.as_str()),
        _ => None,
    };
    let mut verified = VerifiedTokens {
        authenticating: None,
        others: Vec::new(),
    };
    let mut users: Vec<String> = Vec::new();
    // Authentication remains the route's responsibility. Public webhooks and
    // non-Macro credentials may share the listener; only a verified Macro
    // JWT can introduce attribution, never an unsigned header or claim. A
    // token that doesn't verify (expired, or another kind of bearer) signs
    // nothing.
    for token in &credential.user_tokens {
        match macro_auth::middleware::decode_jwt::handler(jwt, token) {
            Ok(JwtToken::MacroApiToken(decoded)) => {
                users.push(decoded.macro_user_id.clone());
                if Some(token.as_str()) == authenticating_token {
                    verified.authenticating = Some(decoded);
                } else {
                    verified.others.push(decoded);
                }
            }
            Ok(JwtToken::MacroAccessToken(decoded)) => users.push(decoded.macro_user_id),
            Err(_) => {}
        }
    }
    users.sort();
    users.dedup();
    if users.len() > 1 {
        tracing::warn!(
            tokens = credential.user_tokens.len(),
            "refused a request carrying tokens of different users"
        );
        return Err(CorrelationRejection(
            CorrelationError::ConflictingCredentials,
        ));
    }
    Ok(verified)
}

/// The narrower of two scopes: a routine dry run's (reads only) is
/// narrowest, then a background job's (its lists only), then a generation
/// session's, then a run's that sends nothing.
fn narrowest(first: Option<SessionScope>, second: Option<SessionScope>) -> Option<SessionScope> {
    match (first, second) {
        (Some(SessionScope::ChannelMention), _) | (_, Some(SessionScope::ChannelMention)) => {
            Some(SessionScope::ChannelMention)
        }
        (Some(SessionScope::DryRun), _) | (_, Some(SessionScope::DryRun)) => {
            Some(SessionScope::DryRun)
        }
        (Some(SessionScope::Job), _) | (_, Some(SessionScope::Job)) => Some(SessionScope::Job),
        (Some(SessionScope::Generation), _) | (_, Some(SessionScope::Generation)) => {
            Some(SessionScope::Generation)
        }
        (Some(SessionScope::NoSend), _) | (_, Some(SessionScope::NoSend)) => {
            Some(SessionScope::NoSend)
        }
        (None, None) => None,
    }
}

/// The scopes of the tokens beside the authenticating one: the narrowest,
/// and whether any caps document tokens.
#[derive(Default, Clone, Copy)]
struct OtherScopes {
    narrowest: Option<SessionScope>,
    caps_document_tokens: bool,
    signed_scope: bool,
}

/// Hold the request to the scopes the tokens beside the authenticating one
/// sign or are stored with (`state`, when there is a database to look their
/// correlations up in), and name the narrowest of them.
async fn other_tokens_scope(
    state: Option<&CorrelationState>,
    specs: Option<&[&str]>,
    others: &[MacroApiToken],
    parts: &Parts,
) -> Result<OtherScopes, CorrelationRejection> {
    let mut scopes = OtherScopes::default();
    for token in others {
        let signed = checked_signed_scope(Some(token), parts, specs)?;
        scopes.signed_scope |= !matches!(signed, SignedScope::Unscoped);
        scopes.narrowest = narrowest(scopes.narrowest, signed.known());
        scopes.caps_document_tokens |= caps(signed.known());
        let Some(state) = state else {
            continue;
        };
        let correlation = accept_correlation(state, Some(token))
            .await?
            .map(|(_, c)| c);
        if !within_own_session(signed, correlation, specs, parts) {
            return Err(CorrelationRejection(CorrelationError::OutOfScope));
        }
        if let Some(stored) = correlation.and_then(|correlation| correlation.scope) {
            scopes.narrowest = narrowest(scopes.narrowest, Some(stored));
            scopes.caps_document_tokens |= caps(Some(stored));
        }
    }
    Ok(scopes)
}

fn caps(scope: Option<SessionScope>) -> bool {
    scope.is_some_and(SessionScope::caps_document_tokens_to_view)
}

/// Whether the request is inside both the signed and the stored scope, with
/// a write's `{session_id}` bound to the correlation's session: a scoped
/// program writes only into the session it runs for. Without a correlation
/// no session is known, so a session-bound entry is refused.
fn within_own_session(
    signed: SignedScope,
    correlation: Option<Correlation>,
    specs: Option<&[&str]>,
    parts: &Parts,
) -> bool {
    let own = correlation.map_or(OwnSession::Unknown, |correlation| {
        OwnSession::Is(correlation.session_id)
    });
    let (method, path) = (parts.method.as_str(), parts.uri.path());
    signed.allows_within(specs, own, method, path)
        && correlation
            .and_then(|correlation| correlation.scope)
            .is_none_or(|stored| stored.allows_within(specs, own, method, path))
}

/// The scope `token` signs, or a refusal when the request is outside it. The
/// signature is the claim's authority, so this needs no lookup. A write's
/// `{session_id}` is checked once the correlation is read
/// ([`within_own_session`]).
fn checked_signed_scope(
    token: Option<&MacroApiToken>,
    parts: &Parts,
    specs: Option<&[&str]>,
) -> Result<SignedScope, CorrelationRejection> {
    let scope = SignedScope::from_claim(token.and_then(|token| token.agent_scope.as_deref()));
    // A verified legacy mention adds the new restriction; it never replaces
    // the original scope (an unknown scope still permits GET only).
    let mention = token.is_some_and(|token| token.channel_mention_id.is_some());
    if !scope.allows_on(specs, parts.method.as_str(), parts.uri.path())
        || (mention
            && !SessionScope::ChannelMention.allows_on(
                specs,
                parts.method.as_str(),
                parts.uri.path(),
            ))
    {
        tracing::warn!(
            ?scope,
            method = %parts.method,
            agent_correlation_id = ?token.and_then(|token| token.agent_correlation_id),
            agent_session_id = ?token.and_then(|token| token.agent_session_id),
            "refused a request outside its credential's signed scope"
        );
        return Err(CorrelationRejection(CorrelationError::OutOfScope));
    }
    Ok(if mention {
        SignedScope::Known(SessionScope::ChannelMention)
    } else {
        scope
    })
}

/// The SDK's display verb. Callers read it only after the correlation that
/// makes it meaningful has been validated; an unknown value is absent.
fn sdk_verb(parts: &Parts) -> Option<crate::AgentVerb> {
    parts
        .headers
        .get("x-macro-sdk-verb")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
}

/// Validate the token's correlation claim against its agent session.
async fn accept_correlation(
    state: &CorrelationState,
    token: Option<&MacroApiToken>,
) -> Result<Option<(Uuid, Correlation)>, CorrelationRejection> {
    let Some((id, agent)) =
        token.and_then(|token| Some((token.agent_correlation_id?, token.agent_id)))
    else {
        return Ok(None);
    };
    let correlation = validate(state.repository.as_ref(), id, agent)
        .await
        .map_err(CorrelationRejection)?;
    tracing::info!(agent_correlation_id = %id, agent_session_id = %correlation.session_id, "accepted agent attribution");
    Ok(Some((id, correlation)))
}

#[derive(Serialize)]
struct ErrorBody {
    message: String,
}

/// A client-safe attribution failure, separate from authorization failures.
#[derive(Debug)]
pub struct CorrelationRejection(CorrelationError);

impl IntoResponse for CorrelationRejection {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            CorrelationError::MissingAgent | CorrelationError::ConflictingCredentials => {
                StatusCode::BAD_REQUEST
            }
            CorrelationError::NotFound => StatusCode::NOT_FOUND,
            CorrelationError::AgentMismatch | CorrelationError::OutOfScope => StatusCode::FORBIDDEN,
            CorrelationError::Unavailable(error) => {
                tracing::error!(?error, "agent correlation lookup failed");
                StatusCode::SERVICE_UNAVAILABLE
            }
        };
        (
            status,
            Json(ErrorBody {
                message: self.0.to_string(),
            }),
        )
            .into_response()
    }
}

impl IntoResponse for SharingRefused {
    fn into_response(self) -> Response {
        (
            StatusCode::FORBIDDEN,
            Json(ErrorBody {
                message: self.to_string(),
            }),
        )
            .into_response()
    }
}

/// Run a request's handling, and answer [`SharingRefused`] (403) when it
/// refused a sharing change and failed. The writes that grant access refuse
/// deep inside services, whose callers turn the refusal into errors of their
/// own; this keeps the answer the same on every route. A request that
/// refused a change and still succeeded keeps its answer.
pub async fn answer_sharing_refusals<F: Future<Output = Response>>(handling: F) -> Response {
    let (response, refused) = crate::context::recording_sharing_refusals(handling).await;
    let status = response.status();
    if refused && (status.is_client_error() || status.is_server_error()) {
        return SharingRefused.into_response();
    }
    response
}

/// Validate before invoking any handler, then isolate attribution to this request:
/// the code-mode correlation and the signed routine a request acts for.
/// A request that refused a sharing change and failed is answered 403
/// ([`answer_sharing_refusals`]).
pub fn propagate(
    state: State<CorrelationState>,
    request: Request,
    next: Next,
) -> impl Future<Output = Response> + Send {
    propagate_request(state, request, next)
}

async fn propagate_request(
    State(state): State<CorrelationState>,
    request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();
    let tokens = match verified_api_tokens(&mut parts, &state.jwt) {
        Ok(tokens) => tokens,
        Err(rejection) => return rejection.into_response(),
    };
    let others_scope =
        match other_tokens_scope(Some(&state), state.specs, &tokens.others, &parts).await {
            Ok(scope) => scope,
            Err(rejection) => return rejection.into_response(),
        };
    let mention = tokens
        .authenticating
        .iter()
        .chain(&tokens.others)
        .find_map(|token| {
            token
                .channel_mention_id
                .map(|id| (id, token.channel_mention_channel_id))
        });
    let token = tokens.authenticating;
    let signed = match checked_signed_scope(token.as_ref(), &parts, state.specs) {
        Ok(signed) => signed,
        Err(rejection) => return rejection.into_response(),
    };
    let correlation = match accept_correlation(&state, token.as_ref()).await {
        Ok(correlation) => correlation,
        Err(error) => return error.into_response(),
    };
    // A session minted with a scope makes only the requests inside it, on
    // every service that accepts its credential. The harness signs the same
    // scope, so this refuses only a credential that doesn't sign one.
    if !within_own_session(
        signed,
        correlation.map(|(_, correlation)| correlation),
        state.specs,
        &parts,
    ) {
        tracing::warn!(
            scope = correlation
                .and_then(|(_, correlation)| correlation.scope)
                .map(SessionScope::as_str),
            method = %parts.method,
            agent_correlation_id = ?correlation.map(|(id, _)| id),
            agent_session_id = ?correlation.map(|(_, correlation)| correlation.session_id),
            "refused a request outside its session's scope"
        );
        return CorrelationRejection(CorrelationError::OutOfScope).into_response();
    }
    let correlation_id = correlation.map(|(id, _)| id);
    // Handlers read the scope stored with the correlation, else the one the
    // credential signs (the harness signs the stored one).
    // The routine claim needs no lookup: the token's signature is its authority.
    let attribution = Attribution {
        correlation_id,
        routine_id: token.as_ref().and_then(|token| token.routine_id),
        channel_mention_id: mention.map(|(id, _)| id),
        channel_mention_channel_id: mention.and_then(|(_, channel)| channel),
        signed_scope: others_scope.signed_scope || !matches!(signed, SignedScope::Unscoped),
        session_id: correlation.map(|(_, correlation)| correlation.session_id),
        scope: narrowest(
            narrowest(
                correlation.and_then(|(_, correlation)| correlation.scope),
                signed.known(),
            ),
            others_scope.narrowest,
        ),
        verb: correlation_id.and_then(|_| sdk_verb(&parts)),
        caps_document_tokens: others_scope.caps_document_tokens
            || caps(signed.known())
            || caps(correlation.and_then(|(_, correlation)| correlation.scope)),
    };
    let handling = answer_sharing_refusals(next.run(Request::from_parts(parts, body)));
    crate::context::scope_attribution(attribution, handling)
        .instrument(tracing::info_span!(
            "agent_sdk_request",
            agent_correlation_id = correlation_id.map(|id| id.to_string()),
            routine_id = attribution.routine_id.map(|id| id.to_string()),
            channel_mention_id = attribution.channel_mention_id.map(|id| id.to_string()),
        ))
        .await
}

/// The scope check for a service with no database to look a correlation up
/// in: refuse a request outside the scope its credential signs before any
/// handler runs. Install it wherever a code-mode credential is accepted and
/// [`propagate`] is not.
/// It binds no service, so a background job's credential is refused
/// everything here ([`SessionScope::allows_on`]); a service a job reads
/// uses [`enforce_signed_scope_serving`].
pub fn enforce_signed_scope(
    State(jwt): State<JwtValidationArgs>,
    request: Request,
    next: Next,
) -> impl Future<Output = Response> + Send {
    enforce_signed_scope_request(jwt, None, request, next)
}

/// What [`enforce_signed_scope_serving`] checks with: the verifier and the
/// OpenAPI specs the service serves.
#[derive(Clone)]
pub struct SignedScopeState {
    /// Existing JWT verifier configuration.
    pub jwt: JwtValidationArgs,
    /// The specs this service serves (`CorrelationState::specs`).
    pub specs: &'static [&'static str],
}

/// [`enforce_signed_scope`] for a service that serves `specs`, so a
/// background job's list entries for it count here.
pub fn enforce_signed_scope_serving(
    State(state): State<SignedScopeState>,
    request: Request,
    next: Next,
) -> impl Future<Output = Response> + Send {
    enforce_signed_scope_request(state.jwt, Some(state.specs), request, next)
}

async fn enforce_signed_scope_request(
    jwt: JwtValidationArgs,
    specs: Option<&'static [&'static str]>,
    request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();
    let tokens = match verified_api_tokens(&mut parts, &jwt) {
        Ok(tokens) => tokens,
        Err(rejection) => return rejection.into_response(),
    };
    if let Err(rejection) = other_tokens_scope(None, specs, &tokens.others, &parts).await {
        return rejection.into_response();
    }
    let token = tokens.authenticating;
    let signed = match checked_signed_scope(token.as_ref(), &parts, specs) {
        Ok(signed) => signed,
        Err(rejection) => return rejection.into_response(),
    };
    // No correlation is read here, so no session is known.
    if !within_own_session(signed, None, specs, &parts) {
        return CorrelationRejection(CorrelationError::OutOfScope).into_response();
    }
    next.run(Request::from_parts(parts, body)).await
}

/// For a service no session scope may reach at all, such as one that fetches
/// whatever its caller names: refuse every request carrying a verified token
/// that signs a scope, a newer one included, before any handler runs.
/// Requests with no Macro API token are the route's own to authenticate.
pub fn refuse_signed_scopes(
    state: State<JwtValidationArgs>,
    request: Request,
    next: Next,
) -> impl Future<Output = Response> + Send {
    refuse_signed_scopes_request(state, request, next)
}

async fn refuse_signed_scopes_request(
    State(jwt): State<JwtValidationArgs>,
    request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();
    let tokens = match verified_api_tokens(&mut parts, &jwt) {
        Ok(tokens) => tokens,
        Err(rejection) => return rejection.into_response(),
    };
    // Every verified token the request carries, so an unscoped one beside a
    // scoped one gains nothing.
    for token in tokens.authenticating.iter().chain(&tokens.others) {
        let scope = SignedScope::from_claim(token.agent_scope.as_deref());
        if scope != SignedScope::Unscoped || token.channel_mention_id.is_some() {
            tracing::warn!(
                ?scope,
                method = %parts.method,
                agent_correlation_id = ?token.agent_correlation_id,
                "refused a scoped credential at a service no scope reaches"
            );
            return CorrelationRejection(CorrelationError::OutOfScope).into_response();
        }
    }
    next.run(Request::from_parts(parts, body)).await
}

#[cfg(test)]
mod test;
