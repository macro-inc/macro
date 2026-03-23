use std::borrow::Cow;

use crate::{FusionAuthClient, Result};

/// User creation operations.
pub mod create;
mod delete;
mod get;
mod register;
mod verify;

impl FusionAuthClient {
    /// Gets a user's FusionAuth ID by their email address.
    #[tracing::instrument(skip(self), fields(application_id=%self.client_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn get_user_id_by_email(&self, email: &str) -> Result<String> {
        get::get_user_id_by_email(&self.auth_client, &self.fusion_auth_base_url, email).await
    }

    /// Creates a new user in FusionAuth.
    /// This will automatically trigger the api::webhooks::user::create_user_webhook to be called
    /// from within FusionAuth as well.
    #[tracing::instrument(skip(self), fields(application_id=%self.client_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn create_user(
        &self,
        user: create::User<'_>,
        skip_verification: bool,
        client_ip: &str,
    ) -> Result<String> {
        create::create_user(
            &self.auth_client,
            &self.fusion_auth_base_url,
            create::CreateUserRequest {
                application_id: Cow::Borrowed(&self.client_id),
                skip_verification,
                user,
            },
            client_ip,
        )
        .await
    }

    /// This API is used to delete a User. Hard deletes the user.
    #[tracing::instrument(skip(self), fields(application_id=%self.client_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn delete_user(&self, user_id: &str) -> Result<()> {
        delete::delete_user(&self.auth_client, &self.fusion_auth_base_url, user_id).await
    }

    /// Registers a user to the application by looking up their email first.
    #[tracing::instrument(skip(self), fields(application_id=%self.client_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn register_user_from_email(&self, email: &str) -> Result<()> {
        // Get the fusionauth user id for the email
        let fusionauth_user_id =
            get::get_user_id_by_email(&self.auth_client, &self.fusion_auth_base_url, email).await?;

        // Register the user
        register::register_user(
            &self.auth_client,
            &self.fusion_auth_base_url,
            &fusionauth_user_id,
            register::RegisterUserRequest {
                registration: register::Registration {
                    application_id: Cow::Borrowed(&self.client_id),
                },
            },
        )
        .await
    }

    /// Registers a user to the application by their user ID.
    #[tracing::instrument(skip(self), fields(application_id=%self.client_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn register_user(&self, user_id: &str) -> Result<()> {
        register::register_user(
            &self.auth_client,
            &self.fusion_auth_base_url,
            user_id,
            register::RegisterUserRequest {
                registration: register::Registration {
                    application_id: Cow::Borrowed(&self.client_id),
                },
            },
        )
        .await
    }

    /// Verifies a user's email with the given verification ID.
    #[tracing::instrument(skip(self), fields(application_id=%self.client_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn verify_email(&self, verification_id: &str, client_ip: &str) -> Result<()> {
        verify::verify_email(
            &self.auth_client,
            &self.fusion_auth_base_url,
            verify::VerifyEmailRequest {
                verification_id: Cow::Borrowed(verification_id),
            },
            client_ip,
        )
        .await
    }

    /// Resends the email verification for the given email.
    #[tracing::instrument(skip(self), fields(application_id=%self.client_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn resend_verify_email(&self, email: &str) -> Result<()> {
        verify::resend_verify_email(
            &self.auth_client,
            &self.fusion_auth_base_url,
            &self.client_id,
            email,
        )
        .await
    }
}
