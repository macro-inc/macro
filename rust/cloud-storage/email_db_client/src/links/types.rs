use chrono::{DateTime, Utc};
use doppleganger::Doppleganger;
use macro_user_id::{email::EmailStr, error::ParseErr, user_id::MacroUserIdStr};
use models_email::service::link::UserProvider;
use sqlx::{Type, types::Uuid};

#[derive(Type, Debug, Clone, Copy, Doppleganger)]
#[sqlx(type_name = "email_user_provider_enum", rename_all = "UPPERCASE")]
#[dg(backward = models_email::email::service::link::UserProvider)]
pub enum DbUserProvider {
    Gmail,
}

impl DbUserProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            DbUserProvider::Gmail => "GMAIL",
        }
    }
}

#[derive(Debug, Clone)]
pub struct DbLink {
    pub id: Uuid,
    pub macro_id: String,
    pub fusionauth_user_id: String,
    pub email_address: String,
    pub provider: DbUserProvider,
    pub is_sync_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<models_email::email::service::link::Link> for DbLink {
    fn from(service_link: models_email::email::service::link::Link) -> Self {
        Self {
            id: service_link.id,
            macro_id: service_link.macro_id.to_string(),
            fusionauth_user_id: service_link.fusionauth_user_id,
            email_address: service_link
                .email_address
                .0
                .lowercase()
                .as_ref()
                .to_string(),
            provider: match service_link.provider {
                models_email::service::link::UserProvider::Gmail => DbUserProvider::Gmail,
            },
            is_sync_active: service_link.is_sync_active,
            created_at: service_link.created_at,
            updated_at: service_link.updated_at,
        }
    }
}

impl TryFrom<DbLink> for models_email::email::service::link::Link {
    type Error = ParseErr;

    fn try_from(value: DbLink) -> Result<Self, Self::Error> {
        let DbLink {
            id,
            macro_id,
            fusionauth_user_id,
            email_address,
            provider,
            is_sync_active,
            created_at,
            updated_at,
        } = value;
        Ok(models_email::email::service::link::Link {
            id,
            macro_id: MacroUserIdStr::try_from(macro_id)?,
            fusionauth_user_id,
            email_address: EmailStr::try_from(email_address)?,
            provider: match provider {
                DbUserProvider::Gmail => UserProvider::Gmail,
            },
            is_sync_active,
            created_at,
            updated_at,
        })
    }
}
