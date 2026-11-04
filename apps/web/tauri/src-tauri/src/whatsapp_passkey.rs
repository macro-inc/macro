//! Answers WhatsApp's passkey challenge during linked-device pairing.
//!
//! When WhatsApp protects pairing with a passkey, the session service stores
//! WhatsApp's WebAuthn request options on the pairing; the web app reads them
//! from DSS (as the signed-in owner) and hands them to this command, then
//! POSTs the returned assertion to `/meta/linked/pairing/{id}/passkey`. This is
//! an authentication handoff only: the hosted session stays the sole WhatsApp
//! endpoint.
//!
//! The command only signs for WhatsApp: the relying party must be WhatsApp's,
//! the origin is fixed to `https://web.whatsapp.com`, user verification is
//! forced on, and the returned assertion is checked against all three before
//! it leaves the process. macOS and Linux reach the phone over caBLE
//! (hybrid); Windows uses the native WebAuthn API; mobile is unsupported.

#[cfg(desktop)]
mod validation;

use serde::Serialize;
use tauri::ipc::Channel;
use uuid::Uuid;

/// What the pairing UI should show while the authenticator runs.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthenticationEvent {
    /// Show this `FIDO:/` URL as a QR code for the phone to scan.
    Qr { value: String },
    /// Ask the user to confirm on the authenticator.
    Touch,
    /// The authenticator is working.
    Processing,
    /// Hide the QR code.
    Dismiss,
}

#[derive(Debug, thiserror::Error, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthenticationError {
    #[cfg(mobile)]
    #[error(
        "This device cannot complete WhatsApp authentication. Use Macro desktop with Bluetooth and your phone nearby."
    )]
    Unsupported,
    #[error("This connection request is no longer valid. Start connecting again.")]
    Invalid,
    #[error("WhatsApp authentication was cancelled or unavailable. Check Bluetooth and try again.")]
    Unavailable,
    #[error("Your phone did not verify you. Unlock your phone and try again.")]
    Unverified,
}

/// Sign WhatsApp's passkey challenge for pairing `pairing_id`.
///
/// `challenge` is the pairing's WebAuthn request options as DSS returns them
/// (`PairState.challenge`): `{ challenge, rpId, allowCredentials,
/// userVerification, timeout, extensions }`. Returns the assertion
/// (`PublicKeyCredential` JSON) for the passkey route.
#[tauri::command]
#[tracing::instrument(
    name = "whatsapp.passkey_authenticate",
    skip_all,
    err,
    fields(pairing_id = %pairing_id)
)]
pub async fn whatsapp_passkey_authenticate(
    pairing_id: Uuid,
    challenge: serde_json::Value,
    on_event: Channel<AuthenticationEvent>,
) -> Result<serde_json::Value, AuthenticationError> {
    #[cfg(desktop)]
    {
        desktop::authenticate(challenge, on_event).await
    }
    #[cfg(mobile)]
    {
        let _ = (challenge, on_event);
        Err(AuthenticationError::Unsupported)
    }
}

#[cfg(desktop)]
mod desktop {
    use super::validation::{WHATSAPP_ORIGIN, request_options, verify_assertion};
    use super::{AuthenticationError, AuthenticationEvent};
    use tauri::ipc::Channel;
    use webauthn_authenticator_rs::WebauthnAuthenticator;

    pub(super) async fn authenticate(
        challenge: serde_json::Value,
        on_event: Channel<AuthenticationEvent>,
    ) -> Result<serde_json::Value, AuthenticationError> {
        let options = request_options(challenge)?;
        let origin = url::Url::parse(WHATSAPP_ORIGIN).map_err(|_| AuthenticationError::Invalid)?;

        // Upstream trace output includes caBLE handshake material, so the whole
        // ceremony runs on its own thread (and current-thread runtime) with no
        // tracing subscriber.
        let (send, receive) = tokio::sync::oneshot::channel();
        std::thread::Builder::new()
            .name("whatsapp-passkey".into())
            .spawn(move || {
                let _quiet =
                    tracing::subscriber::set_default(tracing::subscriber::NoSubscriber::default());
                let _ = send.send(
                    run(origin, options.clone(), on_event).and_then(|credential| {
                        verify_assertion(&options.public_key, &credential)?;
                        serde_json::to_value(credential)
                            .map_err(|_| AuthenticationError::Unavailable)
                    }),
                );
            })
            .map_err(|_| AuthenticationError::Unavailable)?;
        receive
            .await
            .map_err(|_| AuthenticationError::Unavailable)?
    }

    #[cfg(target_os = "windows")]
    fn run(
        origin: url::Url,
        options: webauthn_rs_proto::RequestChallengeResponse,
        _on_event: Channel<AuthenticationEvent>,
    ) -> Result<webauthn_rs_proto::PublicKeyCredential, AuthenticationError> {
        // Windows shows its own WebAuthn dialog, phone (hybrid) included.
        webauthn_authenticator_rs::win10::Win10::default()
            .do_authentication(origin, options)
            .map_err(|_| AuthenticationError::Unavailable)
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn run(
        origin: url::Url,
        options: webauthn_rs_proto::RequestChallengeResponse,
        on_event: Channel<AuthenticationEvent>,
    ) -> Result<webauthn_rs_proto::PublicKeyCredential, AuthenticationError> {
        use webauthn_authenticator_rs::{
            cable::connect_cable_authenticator, types::CableRequestType,
        };

        /// How long the user has to scan the QR code and reach the phone.
        const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| AuthenticationError::Unavailable)?;
        let ui = NativeUi(on_event);
        let mut authenticator = runtime
            .block_on(tokio::time::timeout(
                CONNECT_TIMEOUT,
                connect_cable_authenticator(CableRequestType::GetAssertion, &ui),
            ))
            .map_err(|_| AuthenticationError::Unavailable)?
            .map_err(|_| AuthenticationError::Unavailable)?;
        let _entered = runtime.enter();
        authenticator
            .do_authentication(origin, options)
            .map_err(|_| AuthenticationError::Unavailable)
    }

    /// Forwards the authenticator's UI requests to the pairing screen. Never
    /// answers a PIN prompt: the phone verifies the user itself.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    struct NativeUi(Channel<AuthenticationEvent>);

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    impl std::fmt::Debug for NativeUi {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("WhatsAppPasskeyUi")
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    impl NativeUi {
        fn emit(&self, event: AuthenticationEvent) {
            // The window may be gone; the ceremony still ends on its timeout.
            let _ = self.0.send(event);
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    impl webauthn_authenticator_rs::ui::UiCallback for NativeUi {
        fn request_pin(&self) -> Option<String> {
            None
        }

        fn request_touch(&self) {
            self.emit(AuthenticationEvent::Touch);
        }

        fn processing(&self) {
            self.emit(AuthenticationEvent::Processing);
        }

        fn fingerprint_enrollment_feedback(
            &self,
            _remaining_samples: u32,
            _feedback: Option<webauthn_authenticator_rs::types::EnrollSampleStatus>,
        ) {
        }

        fn cable_qr_code(
            &self,
            _request_type: webauthn_authenticator_rs::types::CableRequestType,
            url: String,
        ) {
            self.emit(AuthenticationEvent::Qr { value: url });
        }

        fn dismiss_qr_code(&self) {
            self.emit(AuthenticationEvent::Dismiss);
        }

        fn cable_status_update(&self, _state: webauthn_authenticator_rs::types::CableState) {
            self.emit(AuthenticationEvent::Processing);
        }
    }
}
