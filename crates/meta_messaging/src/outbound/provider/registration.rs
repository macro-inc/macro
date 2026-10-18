//! Official Cloud API number registration and server-side readiness verification.
use super::*;

impl HttpMetaProvider {
    #[tracing::instrument(skip_all, fields(connection_id=%c.id), err)]
    pub(super) async fn phone_registration_impl(
        &self,
        c: &Connection,
        token: &AccessToken,
    ) -> PortResult<PhoneRegistration> {
        let phone = self
            .graph(
                Provider::Whatsapp,
                token,
                Method::GET,
                &[c.account_id.as_str()],
                &[("fields", "id,is_on_biz_app,platform_type,status")],
                None,
            )
            .await?;
        if phone["id"].as_str() != Some(c.account_id.as_str())
            || phone["is_on_biz_app"] != false
            || phone["platform_type"] == "ON_PREMISE"
        {
            return Err(MessagingError::ProviderRejected.into());
        }
        phone_registration(&phone)
    }

    #[tracing::instrument(skip_all, fields(connection_id=%c.id))]
    pub(super) async fn register_whatsapp_impl(
        &self,
        c: &Connection,
        token: &AccessToken,
        pin: &RegistrationPin,
    ) -> RegistrationResult {
        let response = match self
            .client
            .post(self.endpoint(Provider::Whatsapp, &[c.account_id.as_str(), "register"]))
            .bearer_auth(token.expose())
            .json(&json!({"messaging_product":"whatsapp","pin":pin.expose()}))
            .send()
            .await
        {
            Ok(response) => response,
            Err(_) => return RegistrationResult::Unknown,
        };
        let status = response.status();
        if status.is_server_error() || status == reqwest::StatusCode::REQUEST_TIMEOUT {
            return RegistrationResult::Unknown;
        }
        let bytes = match bounded_bytes(response, 1024 * 1024).await {
            Ok(bytes) => bytes,
            Err(_) if status.is_client_error() => {
                return RegistrationResult::Rejected(RegistrationFailure::Rejected);
            }
            Err(_) => return RegistrationResult::Unknown,
        };
        // A known client rejection remains a rejection even if its body is HTML.
        let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        if status.is_success() && body["success"] == true {
            return RegistrationResult::Accepted;
        }
        if !status.is_success() || body.get("error").is_some() {
            return RegistrationResult::Rejected(match body["error"]["code"].as_i64() {
                Some(133005) => RegistrationFailure::IncorrectPin,
                Some(133006) => RegistrationFailure::PinAttemptsExceeded,
                Some(133016) => RegistrationFailure::RateLimited,
                _ => RegistrationFailure::Rejected,
            });
        }
        RegistrationResult::Unknown
    }
}

/// CONNECTED is verified. Other states cannot prove registration is missing.
pub(super) fn phone_registration(phone: &Value) -> PortResult<PhoneRegistration> {
    let platform = required(phone, "platform_type")?;
    Ok(match required(phone, "status")? {
        "CONNECTED" if platform == "CLOUD_API" => PhoneRegistration::Registered,
        _ => PhoneRegistration::Unavailable,
    })
}
