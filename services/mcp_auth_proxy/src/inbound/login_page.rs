//! Broker-hosted login page rendering.

#[cfg(test)]
mod test;

use crate::domain::models::{LoginPageError, LoginSurface};

const SHELL: &str = include_str!("login_page/shell.html");
const CHOOSE_METHOD: &str = include_str!("login_page/choose_method.html");
const ENTER_OTP: &str = include_str!("login_page/enter_otp.html");
const EXPIRED: &str = include_str!("login_page/expired.html");

pub(super) fn render_login_page(surface: &LoginSurface) -> String {
    match surface {
        LoginSurface::ChooseMethod { session_id } => {
            render_choose_method(session_id.as_str(), None)
        }
        LoginSurface::EnterEmail { session_id, error } => {
            render_choose_method(session_id.as_str(), *error)
        }
        LoginSurface::EnterOtp {
            session_id,
            email,
            local_otp,
            error,
        } => {
            let error = error.map(error_copy).unwrap_or_default();
            let local_otp = local_otp
                .as_ref()
                .map(|code| code.as_str())
                .unwrap_or_default();
            let content = ENTER_OTP
                .replace("{{session_id}}", &escape_html(session_id.as_str()))
                .replace("{{error}}", &escape_html(error))
                .replace("{{error_hidden}}", hidden_when(error.is_empty()))
                .replace("{{local_otp}}", &escape_html(local_otp))
                .replace("{{local_hidden}}", hidden_when(local_otp.is_empty()))
                .replace("{{email}}", &escape_html(email.as_str()));
            render_shell("Enter your code", &content)
        }
        LoginSurface::Expired => render_shell("Sign-in expired", EXPIRED),
    }
}

fn render_choose_method(session_id: &str, error: Option<LoginPageError>) -> String {
    let error = error.map(error_copy).unwrap_or_default();
    let content = CHOOSE_METHOD
        .replace("{{session_id}}", &escape_html(session_id))
        .replace("{{error}}", &escape_html(error))
        .replace("{{error_hidden}}", hidden_when(error.is_empty()));
    render_shell("Sign in to Macro", &content)
}

fn render_shell(title: &str, content: &str) -> String {
    SHELL
        .replace("{{title}}", &escape_html(title))
        .replace("{{content}}", content)
}

fn hidden_when(condition: bool) -> &'static str {
    if condition { "hidden" } else { "" }
}

fn error_copy(error: LoginPageError) -> &'static str {
    match error {
        LoginPageError::InvalidEmail => "Enter a valid email address.",
        LoginPageError::InvalidOtp => "That code is invalid or expired.",
        LoginPageError::RateLimited => "Too many attempts. Try again later.",
        LoginPageError::Unavailable => "Sign-in is temporarily unavailable. Try again.",
        LoginPageError::WrongPhase => {
            "That action is no longer available. Choose a sign-in method."
        }
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
