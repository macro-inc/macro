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

use serde_json::{json, Value};

use super::identity;

/// Build the kickstart document. `lambda_body` is the JS source of
/// `populate_jwt_local.js`; redirect URLs are templated from the instance ports.
pub fn build(frontend_port: u16, auth_port: u16, lambda_body: &str) -> Value {
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
    let requests = vec![
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
        // so FusionAuth-sent passwordless codes land in Mailpit.
        json!({
            "method": "POST",
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

    json!({
        "//": "GENERATED by xtask (cargo x run-local). Deterministic local FusionAuth bootstrap. Do not edit.",
        "apiKeys": [ { "key": identity::FUSIONAUTH_API_KEY, "description": "Local Development API Key" } ],
        "variables": {},
        "requests": requests,
    })
}
