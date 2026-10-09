//! Google Workspace check for the mobile signup email.
//!
//! A work address is one whose domain is not a consumer provider and whose
//! primary MX record is a Google Workspace exchanger. Consumer Gmail uses
//! `gmail-smtp-in.l.google.com`, which is not that list.

const WORKSPACE_MX_HOSTS: [&str; 10] = [
    "smtp.google.com",
    "aspmx.l.google.com",
    "alt1.aspmx.l.google.com",
    "alt2.aspmx.l.google.com",
    "alt3.aspmx.l.google.com",
    "alt4.aspmx.l.google.com",
    "aspmx2.googlemail.com",
    "aspmx3.googlemail.com",
    "aspmx4.googlemail.com",
    "aspmx5.googlemail.com",
];

pub(crate) enum WorkspaceEmailError {
    NotWorkspace,
    Lookup(anyhow::Error),
}

/// Refuses the address unless its domain receives mail through Google Workspace.
pub(crate) async fn ensure_google_workspace_email(
    email: &str,
) -> Result<(), WorkspaceEmailError> {
    let Some(domain) = email.rsplit_once('@').map(|(_, domain)| domain) else {
        return Err(WorkspaceEmailError::NotWorkspace);
    };
    if generic_email_domains::is_generic_email_domain(domain) || !is_dns_name(domain) {
        return Err(WorkspaceEmailError::NotWorkspace);
    }
    let host = lookup_primary_mx(domain).await?;
    if host
        .as_deref()
        .is_some_and(|value| is_workspace_mx_host(value))
    {
        Ok(())
    } else {
        Err(WorkspaceEmailError::NotWorkspace)
    }
}

fn is_workspace_mx_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    WORKSPACE_MX_HOSTS.contains(&host.as_str())
}

fn is_dns_name(domain: &str) -> bool {
    !domain.is_empty()
        && domain.len() <= 253
        && domain.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        && domain.contains('.')
}

/// The MX exchange with the lowest preference, from a Google DNS JSON body.
fn primary_mx_host(body: &serde_json::Value) -> Option<String> {
    if body.get("Status")?.as_u64()? != 0 {
        return None;
    }
    let mut best: Option<(u64, String)> = None;
    for answer in body.get("Answer")?.as_array()? {
        if answer.get("type")?.as_u64()? != 15 {
            continue;
        }
        let data = answer.get("data")?.as_str()?;
        let (preference, host) = data.split_once(char::is_whitespace)?;
        let preference = preference.parse::<u64>().ok()?;
        let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
        if host.is_empty() {
            continue;
        }
        if best.as_ref().is_none_or(|(current, _)| preference < *current) {
            best = Some((preference, host));
        }
    }
    best.map(|(_, host)| host)
}

async fn lookup_primary_mx(domain: &str) -> Result<Option<String>, WorkspaceEmailError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|error| WorkspaceEmailError::Lookup(error.into()))?;
    let response = client
        .get("https://dns.google/resolve")
        .query(&[("name", domain), ("type", "MX")])
        .send()
        .await
        .map_err(|error| {
            tracing::warn!(?error, "workspace mx lookup failed");
            WorkspaceEmailError::Lookup(error.into())
        })?;
    let body: serde_json::Value = response.json().await.map_err(|error| {
        tracing::warn!(?error, "workspace mx lookup returned an unreadable body");
        WorkspaceEmailError::Lookup(error.into())
    })?;
    Ok(primary_mx_host(&body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_mx_is_the_lowest_preference_workspace_host() {
        let body = serde_json::json!({
            "Status": 0,
            "Answer": [
                { "type": 15, "data": "10 alt1.aspmx.l.google.com." },
                { "type": 15, "data": "1 aspmx.l.google.com." }
            ]
        });
        assert_eq!(
            primary_mx_host(&body).as_deref(),
            Some("aspmx.l.google.com")
        );
        assert!(is_workspace_mx_host("aspmx.l.google.com."));
        assert!(!is_workspace_mx_host("gmail-smtp-in.l.google.com"));
    }

    #[test]
    fn consumer_gmail_mx_is_not_workspace() {
        let body = serde_json::json!({
            "Status": 0,
            "Answer": [{ "type": 15, "data": "5 gmail-smtp-in.l.google.com." }]
        });
        let host = primary_mx_host(&body).unwrap();
        assert!(!is_workspace_mx_host(&host));
    }
}
