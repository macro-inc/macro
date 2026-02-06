use crate::config::BASE_URL;

/// Gets the unsubscribe url for an email
#[allow(dead_code)]
fn get_email_unsubscribe_url(email_unsubscribe_code: &str) -> String {
    let base_url = &*BASE_URL;
    format!("{}/unsubscribe/email/{}", base_url, email_unsubscribe_code)
}
