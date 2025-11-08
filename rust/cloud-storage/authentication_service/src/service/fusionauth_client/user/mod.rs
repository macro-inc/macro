use std::borrow::Cow;

use crate::service::fusionauth_client::{FusionAuthClient, Result};

pub mod create;
mod delete;
mod get;
mod register;
mod verify;

impl FusionAuthClient {
    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn get_user_id_by_email(&self, email: &str) -> Result<String> {
        get::get_user_id_by_email(&self.auth_client, &self.fusion_auth_base_url, email).await
    }

    /// Creates a new user in FusionAuth.
    /// This will automatically trigger the api::webhooks::user::create_user_webhook to be called
    /// from within FusionAuth as well.
    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn create_user(
        &self,
        user: create::User<'_>,
        skip_verification: bool,
    ) -> Result<String> {
        create::create_user(
            &self.auth_client,
            &self.fusion_auth_base_url,
            create::CreateUserRequest {
                application_id: Cow::Borrowed(&self.application_id),
                skip_verification,
                user,
            },
        )
        .await
    }

    /// This API is used to delete a User. Hard deletes the user.
    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn delete_user(&self, user_id: &str) -> Result<()> {
        delete::delete_user(&self.auth_client, &self.fusion_auth_base_url, user_id).await
    }

    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
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
                    application_id: Cow::Borrowed(&self.application_id),
                },
            },
        )
        .await
    }

    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn register_user(&self, user_id: &str) -> Result<()> {
        register::register_user(
            &self.auth_client,
            &self.fusion_auth_base_url,
            user_id,
            register::RegisterUserRequest {
                registration: register::Registration {
                    application_id: Cow::Borrowed(&self.application_id),
                },
            },
        )
        .await
    }

    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn verify_email(&self, verification_id: &str) -> Result<()> {
        verify::verify_email(
            &self.auth_client,
            &self.fusion_auth_base_url,
            verify::VerifyEmailRequest {
                verification_id: Cow::Borrowed(verification_id),
            },
        )
        .await
    }

    #[tracing::instrument(skip(self), fields(application_id=%self.application_id, fusion_auth_base_url=%self.fusion_auth_base_url))]
    pub async fn resend_verify_email(&self, email: &str) -> Result<()> {
        verify::resend_verify_email(
            &self.auth_client,
            &self.fusion_auth_base_url,
            &self.application_id,
            email,
        )
        .await
    }
}
