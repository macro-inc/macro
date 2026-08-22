use super::*;
use crate::domain::models::{Email, OneTimeCode, SessionId};

#[test]
fn chooser_has_google_and_email_actions() {
    let html = render_login_page(&LoginSurface::ChooseMethod {
        session_id: SessionId::new(),
    });

    assert!(html.contains("Continue with Google"));
    assert!(html.contains("Continue with email"));
    assert!(html.contains(r#"name="email""#));
}

#[test]
fn otp_page_has_resend_back_and_local_code() {
    let html = render_login_page(&LoginSurface::EnterOtp {
        session_id: SessionId::new(),
        email: Email::parse("person@example.com").unwrap(),
        local_otp: Some(OneTimeCode::parse("123456").unwrap()),
        error: Some(LoginPageError::InvalidOtp),
    });

    assert!(html.contains("123456"));
    assert!(html.contains("That code is invalid or expired."));
    assert!(html.contains("Resend code"));
    assert!(html.contains(">Back<"));
    assert!(html.contains(r#"autocomplete="one-time-code""#));
}
