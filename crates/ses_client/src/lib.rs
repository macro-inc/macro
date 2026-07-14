mod invite_user;
mod send_email;
mod send_email_smtp;

use aws_sdk_sesv2 as ses;
#[allow(unused_imports)]
use mockall::automock;

macro_env_var::maybe_env_vars! {
    struct SmtpHost;
    struct SmtpPort;
}

#[cfg(test)]
pub use MockSesClient as Ses;
#[cfg(not(test))]
pub use SesClient as Ses;

/// How outbound mail is delivered. SES in dev/prod; SMTP to a local Mailpit in
/// local mode (selected by the `SMTP_HOST` env var).
#[derive(Clone, Debug)]
enum Transport {
    Ses(ses::Client),
    Smtp { host: String, port: u16 },
}

#[derive(Clone, Debug)]
pub struct SesClient {
    transport: Transport,
    invite_email: Option<String>,
    environment: String,
}

#[cfg_attr(test, automock)]
impl SesClient {
    /// Construct from the environment: route to local SMTP (Mailpit) when
    /// `SMTP_HOST` is set, otherwise SES. The SES client is still passed in (and
    /// kept for the SES path) so callers don't branch.
    pub fn from_env(inner: ses::Client, environment: &str) -> Self {
        let transport = match SmtpHost::new().and_then(|host| host.value().map(str::to_string)) {
            Some(host) if !host.is_empty() => {
                let port = SmtpPort::new()
                    .and_then(|p| p.value().and_then(|p| p.parse().ok()))
                    .unwrap_or(1025);
                Transport::Smtp { host, port }
            }
            _ => Transport::Ses(inner),
        };
        Self {
            transport,
            invite_email: None,
            environment: environment.to_string(),
        }
    }

    /// Sets the invite_email
    pub fn invite_email(mut self, invite_email: &str) -> Self {
        self.invite_email = Some(invite_email.to_string());
        self
    }

    /// Sends an invitation email to the user
    #[tracing::instrument(skip(self))]
    pub async fn invite_user(&self, organization_name: &str, email: &str) -> anyhow::Result<()> {
        let Some(invite_email) = self.invite_email.clone() else {
            return Err(anyhow::anyhow!("invite_email is not set"));
        };
        let html = invite_user::build_user_invite_message(organization_name, &self.environment);
        self.deliver(
            &invite_email,
            email,
            invite_user::INVITE_USER_SUBJECT,
            &html,
        )
        .await
    }

    /// Sends an email to the user
    #[tracing::instrument(skip(self, subject, content))]
    pub async fn send_email(
        &self,
        from_email: &str,
        to_email: &str,
        subject: &str,
        content: &str,
    ) -> anyhow::Result<()> {
        self.deliver(from_email, to_email, subject, content).await
    }
}

impl SesClient {
    /// Route a fully-rendered HTML email through the active transport.
    async fn deliver(
        &self,
        from_email: &str,
        to_email: &str,
        subject: &str,
        content: &str,
    ) -> anyhow::Result<()> {
        match &self.transport {
            Transport::Ses(client) => {
                send_email::send_email(client, from_email, to_email, subject, content).await
            }
            Transport::Smtp { host, port } => {
                send_email_smtp::send_email_smtp(
                    host, *port, from_email, to_email, subject, content,
                )
                .await
            }
        }
    }
}
