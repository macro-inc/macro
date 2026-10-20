//! A narrow WhatsApp relying-party authenticator. This is an authentication
//! handoff only; the hosted session remains the sole WhatsApp endpoint.
use serde::Serialize;
use tauri::ipc::Channel;

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthenticationEvent {
    Qr { value: String },
    Touch,
    Processing,
    Dismiss,
}
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthenticationError {
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    #[error(
        "This device cannot complete WhatsApp authentication. Use Macro desktop with Bluetooth and your phone nearby."
    )]
    Unsupported,
    #[error("This connection request is no longer valid. Start connecting again.")]
    Invalid,
    #[error("WhatsApp authentication was cancelled or unavailable. Check Bluetooth and try again.")]
    Unavailable,
}

#[tauri::command]
pub async fn authenticate_whatsapp_passkey(
    challenge: serde_json::Value,
    on_event: Channel<AuthenticationEvent>,
) -> Result<serde_json::Value, AuthenticationError> {
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    {
        let rp = challenge.get("rpId").and_then(serde_json::Value::as_str);
        if !matches!(rp, Some("whatsapp.com" | "web.whatsapp.com"))
            || challenge
                .get("challenge")
                .and_then(serde_json::Value::as_str)
                .is_none_or(|c| c.is_empty() || c.len() > 1024)
        {
            return Err(AuthenticationError::Invalid);
        }
        // Require real local user verification even if a remote request accepts
        // weaker verification. Do not alter the challenge or relying-party ID.
        let mut challenge = challenge;
        challenge["userVerification"] = serde_json::Value::String("required".into());
        challenge["timeout"] = serde_json::json!(120000);
        let options: webauthn_rs_proto::RequestChallengeResponse =
            serde_json::from_value(serde_json::json!({"publicKey":challenge}))
                .map_err(|_| AuthenticationError::Invalid)?;
        let origin = url::Url::parse("https://web.whatsapp.com")
            .map_err(|_| AuthenticationError::Invalid)?;
        // Upstream trace diagnostics include handshake material. Run the complete
        // authenticator on an isolated thread/runtime with no tracing subscriber.
        let (send, receive) = tokio::sync::oneshot::channel();
        std::thread::spawn(move || {
            use webauthn_authenticator_rs::WebauthnAuthenticator;
            let _quiet =
                tracing::subscriber::set_default(tracing::subscriber::NoSubscriber::default());
            let result = (|| {
                #[cfg(target_os = "windows")]
                {
                    let mut authenticator = webauthn_authenticator_rs::win10::Win10::default();
                    let result = authenticator
                        .do_authentication(origin, options)
                        .map_err(|_| AuthenticationError::Unavailable)?;
                    serde_json::to_value(result).map_err(|_| AuthenticationError::Unavailable)
                }
                #[cfg(any(target_os = "macos", target_os = "linux"))]
                {
                    use webauthn_authenticator_rs::{
                        cable::connect_cable_authenticator, types::CableRequestType,
                    };
                    let runtime = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .map_err(|_| AuthenticationError::Unavailable)?;
                    let ui = NativeUi(on_event);
                    let mut authenticator = runtime
                        .block_on(async {
                            tokio::time::timeout(
                                std::time::Duration::from_secs(120),
                                connect_cable_authenticator(CableRequestType::GetAssertion, &ui),
                            )
                            .await
                        })
                        .map_err(|_| AuthenticationError::Unavailable)?
                        .map_err(|_| AuthenticationError::Unavailable)?;
                    let _entered = runtime.enter();
                    let result = authenticator
                        .do_authentication(origin, options)
                        .map_err(|_| AuthenticationError::Unavailable)?;
                    serde_json::to_value(result).map_err(|_| AuthenticationError::Unavailable)
                }
            })();
            let _ = send.send(result);
        });
        receive
            .await
            .map_err(|_| AuthenticationError::Unavailable)?
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (challenge, on_event);
        Err(AuthenticationError::Unsupported)
    }
}
#[cfg(any(target_os = "macos", target_os = "linux"))]
struct NativeUi(Channel<AuthenticationEvent>);
#[cfg(any(target_os = "macos", target_os = "linux"))]
impl std::fmt::Debug for NativeUi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WhatsAppAuthenticator")
    }
}
#[cfg(any(target_os = "macos", target_os = "linux"))]
impl webauthn_authenticator_rs::ui::UiCallback for NativeUi {
    fn request_pin(&self) -> Option<String> {
        None
    }
    fn request_touch(&self) {
        let _ = self.0.send(AuthenticationEvent::Touch);
    }
    fn processing(&self) {
        let _ = self.0.send(AuthenticationEvent::Processing);
    }
    fn fingerprint_enrollment_feedback(
        &self,
        _: u32,
        _: Option<webauthn_authenticator_rs::types::EnrollSampleStatus>,
    ) {
    }
    fn cable_qr_code(&self, _: webauthn_authenticator_rs::types::CableRequestType, value: String) {
        let _ = self.0.send(AuthenticationEvent::Qr { value });
    }
    fn dismiss_qr_code(&self) {
        let _ = self.0.send(AuthenticationEvent::Dismiss);
    }
    fn cable_status_update(&self, _: webauthn_authenticator_rs::types::CableState) {
        let _ = self.0.send(AuthenticationEvent::Processing);
    }
}
