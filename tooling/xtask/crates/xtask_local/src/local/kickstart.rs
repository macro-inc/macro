//! The deterministic FusionAuth kickstart document.
//!
//! Replaces the Pulumi-driven local FusionAuth configuration with a single
//! declarative kickstart that FusionAuth applies once against an empty DB:
//! API key, HS256 signing key, the (unlicensed) populate-JWT lambda, and the
//! tenant and Macro application with fixed ids + a fixed client secret. Every
//! id/secret is fixed (see `identity`) so services and FusionAuth always agree
//! without any API read-back or patch step. The admin user is provisioned last
//! (after the app it registers against exists); passwordless login auto-creates
//! all other users on demand.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::identity;

#[cfg(test)]
mod test;

/// The Google OAuth web client the local `google`/`google_gmail` OIDC identity
/// providers authenticate against (the Internal client in the
/// `macro-email-testing` GCP project — see the macro-2634 proposal). Optional:
/// without it the kickstart is unchanged and the email connect flows stay
/// unreachable locally, exactly as before.
pub struct GoogleIdp {
    pub client_id: String,
    pub client_secret: String,
}

impl GoogleIdp {
    /// Extract the Google client from the resolved run env (Doppler supplies
    /// `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET_KEY`; in local mode
    /// authentication_service uses the latter directly as the secret value).
    ///
    /// The `GOCSPX-` check is load-bearing, not cosmetic: older Doppler local
    /// configs carry a Secrets-Manager key *name* (`google-client-secret-dev`)
    /// in `GOOGLE_CLIENT_SECRET_KEY`. Real Google web-client secrets all carry
    /// the `GOCSPX-` prefix; creating the IdPs with the placeholder would bake
    /// a broken FusionAuth config into the init snapshot.
    pub fn from_env(env: &BTreeMap<String, String>) -> Option<Self> {
        let client_id = env.get("GOOGLE_CLIENT_ID")?.trim().to_string();
        let client_secret = env.get("GOOGLE_CLIENT_SECRET_KEY")?.trim().to_string();
        if client_id.is_empty() || !client_secret.starts_with("GOCSPX-") {
            return None;
        }
        Some(GoogleIdp {
            client_id,
            client_secret,
        })
    }
}

/// The GitHub OAuth app the local `github` identity provider authenticates
/// against. Optional on the same terms as [`GoogleIdp`]: without it the
/// kickstart is unchanged and `POST /link/github` stays unreachable locally.
pub struct GithubIdp {
    pub client_id: String,
    pub client_secret: String,
    pub idp_id: String,
}

impl GithubIdp {
    /// Extract the GitHub OAuth client from the resolved run env. The same
    /// `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` pair `authentication_service`
    /// builds its authorization URL from - the provider and the service have to
    /// agree on the client or the callback cannot be linked.
    ///
    /// The id comes from the same env rather than from [`identity`], because
    /// unlike the Google providers - which are only ever resolved by name -
    /// `authentication_service` reads `GITHUB_IDP_ID` as config, and Doppler
    /// overrides it with the dev instance's id. Pinning our own constant here
    /// would create the provider somewhere the service never looks: the
    /// by-name lookup that starts a link would succeed while every link call
    /// addressed a provider that does not exist. The constant is the fallback
    /// for a stack with no Doppler layer.
    ///
    /// The `local-` check is load-bearing, not cosmetic: a no-Doppler stack
    /// fills both with `local-github-client…` placeholders so the service's
    /// config loader is satisfied, and creating the provider with those would
    /// bake a broken FusionAuth config into the init snapshot - which then
    /// looks like a *configured* GitHub connector that fails at the callback,
    /// rather than one that is plainly absent.
    pub fn from_env(env: &BTreeMap<String, String>) -> Option<Self> {
        let client_id = env.get("GITHUB_CLIENT_ID")?.trim().to_string();
        let client_secret = env.get("GITHUB_CLIENT_SECRET")?.trim().to_string();
        if client_id.is_empty()
            || client_secret.is_empty()
            || client_id.starts_with("local-")
            || client_secret.starts_with("local-")
        {
            return None;
        }
        let idp_id = env
            .get("GITHUB_IDP_ID")
            .map(|id| id.trim())
            .filter(|id| !id.is_empty())
            .unwrap_or(identity::GITHUB_IDP_ID)
            .to_string();
        Some(GithubIdp {
            client_id,
            client_secret,
            idp_id,
        })
    }
}

/// Build the kickstart document. `lambda_body` is the JS source of
/// `populate_jwt_local.js`; `reconcile_lambda_body` is the reconcile lambda
/// attached to `google_gmail` (only used when `google` is configured); redirect
/// URLs are templated from the instance ports.
pub fn build(
    frontend_port: u16,
    auth_port: u16,
    lambda_body: &str,
    reconcile_lambda_body: &str,
    google: Option<&GoogleIdp>,
    github: Option<&GithubIdp>,
) -> Value {
    let app_id = identity::APPLICATION_ID;
    let tenant_id = identity::TENANT_ID;
    let key_id = identity::JWT_SIGNING_KEY_ID;
    let lambda_id = identity::POPULATE_JWT_LAMBDA_ID;
    let template_id = identity::PASSWORDLESS_EMAIL_TEMPLATE_ID;

    let redirect_urls = json!([
        format!("http://localhost:{frontend_port}/app"),
        identity::oauth_redirect_uri(auth_port),
        "http://authentication-service:8080/oauth/redirect",
        "http://localhost:8085/oauth/redirect",
        "https://mcp-server-local.macro.com/oauth/callback",
    ]);

    // Kickstart executes these in order, so each request must come after the
    // entities it references. Dependency chain:
    //   key + email template -> tenant
    //   tenant + key + lambda -> application
    //   application (incl. its `admin` role) + tenant -> user registration
    // The user registration is also kept BEFORE the webhooks on purpose: the
    // tenant marks `user.create` as AbsoluteMajority, so once the global
    // user.create webhook exists, creating a user would roll back unless
    // auth-service returns 2xx — which it isn't guaranteed to during kickstart.
    let mut requests = vec![
        // 1. HS256 signing key.
        json!({
            "method": "POST",
            "url": format!("/api/key/import/{key_id}"),
            "body": { "key": {
                "id": key_id,
                "algorithm": "HS256",
                "name": "Local JWT Signing Key",
                "secret": identity::JWT_SECRET,
                "type": "HMAC",
            }}
        }),
        // 2. Populate-JWT lambda (unlicensed local variant).
        json!({
            "method": "POST",
            "url": format!("/api/lambda/{lambda_id}"),
            "body": { "lambda": {
                "id": lambda_id,
                "name": "Populate JWT (local)",
                "type": "JWTPopulate",
                "enabled": true,
                "body": lambda_body,
            }}
        }),
        // 3. Passwordless email template (FA sends the login code itself).
        // `${code}` is FreeMarker, evaluated by FA at send time — it survives
        // kickstart's `#{}`-only variable substitution untouched.
        json!({
            "method": "POST",
            "url": format!("/api/email/template/{template_id}"),
            "body": { "emailTemplate": {
                "name": "Passwordless Login (local)",
                "defaultSubject": "Your Macro login code",
                "defaultHtmlTemplate": "<p>Your Macro login code:</p><h1>${code}</h1>",
                "defaultTextTemplate": "Your Macro login code: ${code}",
                "fromEmail": identity::MAIL_FROM,
            }}
        }),
        // 4. Tenant — with SMTP pointed at Mailpit + the passwordless template,
        // so FusionAuth-sent passwordless codes land in Mailpit. PATCH, not
        // POST: `variables.defaultTenantId` (below) pins FusionAuth's built-in
        // default tenant to our fixed id, and this request reconfigures that
        // tenant in place. Local stays single-tenant this way — a second
        // tenant would force the tenant header onto every API call, and the
        // identity-provider search API returns nothing when that header is
        // present.
        json!({
            "method": "PATCH",
            "url": format!("/api/tenant/{tenant_id}"),
            "body": { "tenant": {
                "name": "Macro Local",
                "issuer": identity::ISSUER,
                // Enable the events the create/delete user webhooks consume, so
                // FusionAuth notifies auth-service to register new users for the
                // app (a registered user is what makes passwordless complete
                // return 200 instead of 202).
                "eventConfiguration": { "events": {
                    "user.create": { "enabled": true, "transactionType": "AbsoluteMajority" },
                    "user.create.complete": { "enabled": true, "transactionType": "None" },
                    "user.delete.complete": { "enabled": true, "transactionType": "None" },
                    "user.email.verified": { "enabled": true, "transactionType": "AbsoluteMajority" },
                }},
                "jwtConfiguration": {
                    "accessTokenKeyId": key_id,
                    "idTokenKeyId": key_id,
                    "refreshTokenTimeToLiveInMinutes": 43200,
                    "timeToLiveInSeconds": 3600,
                },
                "emailConfiguration": {
                    "host": "mailpit",
                    "port": 1025,
                    "security": "NONE",
                    "defaultFromEmail": identity::MAIL_FROM,
                    "defaultFromName": "Macro Local",
                    "passwordlessEmailTemplateId": template_id,
                },
                // Make the passwordless code a 6-digit number (matches the dev
                // Pulumi tenant config), not FusionAuth's default long token.
                "externalIdentifierConfiguration": {
                    "passwordlessLoginGenerator": {
                        "length": 6,
                        "type": "randomDigits",
                    },
                },
            }}
        }),
        // 5. Macro application. `tenantId` sets the X-FusionAuth-TenantId header
        // (required for tenant-scoped ops once a second tenant exists).
        json!({
            "method": "POST",
            "url": format!("/api/application/{app_id}"),
            "tenantId": tenant_id,
            "body": { "application": {
                "name": "Macro",
                "tenantId": tenant_id,
                // The passwordless /login endpoint issues a refresh token based
                // on loginConfiguration.generateRefreshTokens; without it FA omits
                // refreshToken and auth-service fails to decode the response.
                "loginConfiguration": {
                    "allowTokenRefresh": true,
                    "requireAuthentication": true,
                    "generateRefreshTokens": true,
                },
                "oauthConfiguration": {
                    "clientId": app_id,
                    "clientSecret": identity::CLIENT_SECRET,
                    "enabledGrants": ["authorization_code", "refresh_token"],
                    "authorizedRedirectURLs": redirect_urls,
                    "authorizedURLValidationPolicy": "AllowWildcards",
                    "logoutBehavior": "AllApplications",
                    "generateRefreshTokens": true,
                    "requireClientAuthentication": false,
                },
                "jwtConfiguration": {
                    "enabled": true,
                    "accessTokenKeyId": key_id,
                    "idTokenKeyId": key_id,
                    "timeToLiveInSeconds": 3600,
                    "refreshTokenTimeToLiveInMinutes": 43200,
                    "refreshTokenExpirationPolicy": "SlidingWindow",
                },
                "lambdaConfiguration": { "accessTokenPopulateId": lambda_id },
                // Macro logs users in with email codes; enable passwordless.
                "passwordlessConfiguration": { "enabled": true },
            }}
        }),
        // 6. Admin user.
        json!({
            "method": "POST",
            "url": "/api/user/registration",
            "body": {
                "user": {
                    "email": "admin@macro.com",
                    "password": "macroIsGreat!",
                },
                "registration": {
                    "applicationId": "3c219e58-ed0e-4b18-ad48-f4f92793ae32", // FusionAuth's reserved client application id
                    "roles": ["admin"],
                }
            }
        }),
        // 7. Webhooks: on user.create FusionAuth calls auth-service, which
        // registers the new user for the Macro app (so passwordless completes
        // with 200). `x-internal-auth-key` must equal the services'
        // INTERNAL_API_SECRET_KEY (set to "local" in local mode).
        json!({
            "method": "POST",
            "url": "/api/webhook",
            "body": { "webhook": {
                "description": "Create User Webhook",
                "connectTimeout": 1000,
                "readTimeout": 2000,
                "url": "http://authentication-service:8080/webhooks/user",
                "global": true,
                "eventsEnabled": {
                    "user.create": true,
                    "user.create.complete": true,
                    "user.email.verified": true,
                },
                "headers": { "x-internal-auth-key": identity::INTERNAL_AUTH_KEY },
            }}
        }),
        json!({
            "method": "POST",
            "url": "/api/webhook",
            "body": { "webhook": {
                "description": "Delete User Webhook",
                "connectTimeout": 1000,
                "readTimeout": 2000,
                "url": "http://authentication-service:8080/webhooks/user/delete",
                "global": true,
                "eventsEnabled": { "user.delete.complete": true },
                "headers": { "x-internal-auth-key": identity::INTERNAL_AUTH_KEY },
            }}
        }),
    ];

    // Google OIDC identity providers — only when a real Google client is
    // configured (see `GoogleIdp::from_env`). Mirrors the dev instance's IdP
    // config field-for-field (generic OIDC, NOT FusionAuth's built-in Google
    // type: auth-service and the IdP must share the same OAuth client, and the
    // endpoints stay per-IdP config). Appended last: `applicationConfiguration`
    // references the application, which must already exist.
    if let Some(google) = google {
        let oauth2_base = |scope: &str| {
            json!({
                "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth?prompt=consent&access_type=offline",
                "token_endpoint": "https://oauth2.googleapis.com/token",
                "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
                "client_id": google.client_id.as_str(),
                "client_secret": google.client_secret.as_str(),
                "clientAuthenticationMethod": "client_secret_basic",
                "scope": scope,
                "uniqueIdClaim": "sub",
                "emailClaim": "email",
                "emailVerifiedClaim": "email_verified",
                "usernameClaim": "preferred_username",
            })
        };
        let app_config = json!({
            identity::APPLICATION_ID: { "enabled": true, "createRegistration": true }
        });
        requests.push(json!({
            "method": "POST",
            "url": format!("/api/lambda/{}", identity::RECONCILE_LAMBDA_ID),
            "body": { "lambda": {
                "id": identity::RECONCILE_LAMBDA_ID,
                "name": "Reconcile Secondary IdP Link (local)",
                "type": "OpenIDReconcile",
                "enabled": true,
                "body": reconcile_lambda_body,
            }}
        }));
        requests.push(json!({
            "method": "POST",
            "url": format!("/api/identity-provider/{}", identity::GOOGLE_IDP_ID),
            "body": { "identityProvider": {
                "type": "OpenIDConnect",
                "name": "google",
                "enabled": true,
                "debug": true,
                "buttonText": "Google",
                "linkingStrategy": "LinkByEmail",
                "oauth2": oauth2_base("openid profile email"),
                "applicationConfiguration": app_config.clone(),
            }}
        }));
        requests.push(json!({
            "method": "POST",
            "url": format!("/api/identity-provider/{}", identity::GOOGLE_GMAIL_IDP_ID),
            "body": { "identityProvider": {
                "type": "OpenIDConnect",
                "name": "google_gmail",
                "enabled": true,
                "debug": true,
                "buttonText": "GoogleGmail",
                "linkingStrategy": "LinkByEmail",
                "lambdaConfiguration": { "reconcileId": identity::RECONCILE_LAMBDA_ID },
                "oauth2": oauth2_base("openid profile email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly https://www.googleapis.com/auth/gmail.settings.basic https://www.googleapis.com/auth/calendar"),
                "applicationConfiguration": app_config,
            }}
        }));
    }

    // The `github` identity provider, when a real GitHub client is configured
    // (see `GithubIdp::from_env`). Generic OIDC with GitHub's endpoints spelled
    // out, like the Google providers above - FusionAuth has no GitHub provider
    // type at all (it rejects one with `[invalidJSON]`, listing the types it
    // does accept), and GitHub publishes no discovery document to point at.
    // Nothing drives this provider's own OAuth flow: Macro builds the
    // authorization URL and only uses FusionAuth to record the resulting link,
    // so these endpoints exist to make the provider well-formed rather than to
    // be dialled.
    //
    // The name is fixed and the id is the service's own `GITHUB_IDP_ID`.
    // `authentication_service` resolves this provider by name to start a link,
    // then addresses it by that id for the link itself, so one provider has to
    // answer to both. Macro builds the authorization URL itself and only uses
    // FusionAuth to record the link, which is why the client here must be the
    // same one the service holds.
    if let Some(github) = github {
        requests.push(json!({
            "method": "POST",
            "url": format!("/api/identity-provider/{}", github.idp_id),
            "body": { "identityProvider": {
                "type": "OpenIDConnect",
                "name": "github",
                "enabled": true,
                "debug": true,
                "buttonText": "GitHub",
                "linkingStrategy": "LinkByEmail",
                "oauth2": {
                    "authorization_endpoint": "https://github.com/login/oauth/authorize",
                    "token_endpoint": "https://github.com/login/oauth/access_token",
                    "userinfo_endpoint": "https://api.github.com/user",
                    "client_id": github.client_id.as_str(),
                    "client_secret": github.client_secret.as_str(),
                    "clientAuthenticationMethod": "client_secret_basic",
                    // Enough to identify the account being linked. A GitHub
                    // user can keep their address private, so the email scope
                    // is explicit rather than assumed.
                    "scope": "read:user user:email",
                    // GitHub's `/user` names these differently from OIDC: `id`
                    // rather than `sub`, `login` rather than
                    // `preferred_username`.
                    "uniqueIdClaim": "id",
                    "emailClaim": "email",
                    "usernameClaim": "login",
                },
                "applicationConfiguration": json!({
                    identity::APPLICATION_ID: { "enabled": true, "createRegistration": true }
                }),
            }}
        }));
    }

    json!({
        "//": "GENERATED by xtask (cargo x run-local). Deterministic local FusionAuth bootstrap. Do not edit.",
        "apiKeys": [ { "key": identity::FUSIONAUTH_API_KEY, "description": "Local Development API Key" } ],
        // `defaultTenantId` renames FusionAuth's built-in default tenant to our
        // fixed id at schema-creation time, so the tenant request above can
        // adopt it instead of creating a second tenant.
        "variables": { "defaultTenantId": identity::TENANT_ID },
        "requests": requests,
    })
}
