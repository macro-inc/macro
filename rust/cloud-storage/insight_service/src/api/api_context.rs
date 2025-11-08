use crate::config::Config;
use anyhow::Context;
use axum::extract::FromRef;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use sqlx::{PgPool, Pool};

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub macro_db: PgPool,
    jwt_args: JwtValidationArgs,
    config: Config,
}

impl ApiContext {
    pub async fn connect_from_config(
        config: Config,
        jwt_args: JwtValidationArgs,
    ) -> Result<ApiContext, anyhow::Error> {
        let macro_db_client = Pool::connect(&config.macro_db_url)
            .await
            .context("MACRODB Connection failed")?;
        Ok(ApiContext {
            macro_db: macro_db_client,
            jwt_args,
            config,
        })
    }
}
