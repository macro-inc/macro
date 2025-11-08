mod invite_user;
mod send_email;

use aws_sdk_sesv2 as ses;
#[allow(unused_imports)]
use mockall::automock;

#[cfg(test)]
pub use MockSesClient as Ses;
#[cfg(not(test))]
pub use SesClient as Ses;

#[derive(Clone, Debug)]
pub struct SesClient {
    inner: ses::Client,
    invite_email: Option<String>,
    environment: String,
}

#[cfg_attr(test, automock)]
impl SesClient {
    pub fn new(inner: ses::Client, environment: &str) -> Self {
        Self {
            inner,
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
        if let Some(invite_email) = &self.invite_email {
            return invite_user::invite_user(
                &self.inner,
                organization_name,
                self.environment.as_str(),
                invite_email.as_str(),
                email,
            )
            .await;
        }

        Err(anyhow::anyhow!("invite_email is not set"))
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
        send_email::send_email(&self.inner, from_email, to_email, subject, content).await
    }
}
