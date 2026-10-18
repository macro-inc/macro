//! Validated optional configuration; all environment access uses Macro's loader.

use meta_messaging::{
    domain::connection::{AccessToken, PublicConfiguration},
    inbound::router::{WebhookConfiguration, WebhookCredentials},
    outbound::provider::{
        HttpMetaProvider, InstagramCredentials, WhatsappCredentials, WhatsappDeveloperAccount,
    },
};

macro_env_var::maybe_env_vars! {
    pub struct AttachmentBucket;
    pub struct MetaWhatsappAppId;
    pub struct MetaWhatsappAppSecret;
    pub struct MetaWhatsappConfigurationId;
    pub struct MetaWhatsappPlatformConfigurationId;
    pub struct MetaWhatsappVerifyToken;
    pub struct MetaInstagramAppId;
    pub struct MetaInstagramAppSecret;
    pub struct MetaInstagramRedirectUri;
    pub struct MetaInstagramVerifyToken;
    pub struct MetaInstagramHumanAgentApproved;
    pub struct MetaCredentialKmsKey;
    pub struct MetaWhatsappTestBusinessAccountId;
    pub struct MetaWhatsappTestPhoneNumberId;
    pub struct MetaWhatsappTestToken;
    pub struct MetaWhatsappTestRecipients;
}

pub(super) struct Settings {
    pub public: PublicConfiguration,
    pub provider: HttpMetaProvider,
    pub webhooks: WebhookConfiguration,
    pub kms_key: Option<String>,
    pub temporary_media_bucket: Option<String>,
}

impl Settings {
    pub fn load(environment: macro_env::Environment) -> anyhow::Result<Self> {
        let wa_id = MetaWhatsappAppId::new().map(|v| v.to_string());
        let wa_secret = MetaWhatsappAppSecret::new().map(|v| v.to_string());
        let wa_configuration = MetaWhatsappConfigurationId::new().map(|v| v.to_string());
        let wa_platform_configuration = MetaWhatsappPlatformConfigurationId::new()
            .map(|v| v.to_string())
            .filter(|value| !value.is_empty());
        let wa_verify = MetaWhatsappVerifyToken::new().map(|v| v.to_string());
        let ig_id = MetaInstagramAppId::new().map(|v| v.to_string());
        let ig_secret = MetaInstagramAppSecret::new().map(|v| v.to_string());
        let ig_redirect = MetaInstagramRedirectUri::new().map(|v| v.to_string());
        let ig_verify = MetaInstagramVerifyToken::new().map(|v| v.to_string());
        let kms_key = MetaCredentialKmsKey::new().map(|v| v.to_string());
        let whatsapp = match (
            &wa_id,
            &wa_secret,
            wa_configuration
                .as_ref()
                .or(wa_platform_configuration.as_ref()),
            &wa_verify,
        ) {
            (Some(id), Some(secret), Some(_), Some(_)) => Some(WhatsappCredentials {
                app_id: id.clone(),
                app_secret: AccessToken::new(secret.clone())?,
            }),
            (Some(id), Some(secret), None, Some(_))
                if matches!(environment, macro_env::Environment::Local)
                    && MetaWhatsappTestToken::new().is_some() =>
            {
                Some(WhatsappCredentials {
                    app_id: id.clone(),
                    app_secret: AccessToken::new(secret.clone())?,
                })
            }
            (None, None, None, None) => None,
            _ => anyhow::bail!(
                "configure all META_WHATSAPP_APP_ID, APP_SECRET, CONFIGURATION_ID and VERIFY_TOKEN values together"
            ),
        };
        let instagram = match (&ig_id, &ig_secret, &ig_redirect, &ig_verify) {
            (Some(id), Some(secret), Some(uri), Some(_)) => Some(InstagramCredentials {
                app_id: id.clone(),
                app_secret: AccessToken::new(secret.clone())?,
                redirect_uri: uri.clone(),
            }),
            (None, None, None, None) => None,
            _ => anyhow::bail!(
                "configure all META_INSTAGRAM_APP_ID, APP_SECRET, REDIRECT_URI and VERIFY_TOKEN values together"
            ),
        };
        let mut provider = HttpMetaProvider::new("v26.0".into(), whatsapp, instagram)?;
        let developer = match (
            MetaWhatsappTestBusinessAccountId::new(),
            MetaWhatsappTestPhoneNumberId::new(),
            MetaWhatsappTestToken::new(),
            MetaWhatsappTestRecipients::new(),
        ) {
            (Some(account), Some(phone), Some(token), Some(recipients)) => {
                anyhow::ensure!(
                    matches!(environment, macro_env::Environment::Local),
                    "WhatsApp test accounts are permitted only in the isolated local environment"
                );
                anyhow::ensure!(
                    wa_secret.is_some() && wa_verify.is_some(),
                    "WhatsApp test accounts still require signed webhook configuration"
                );
                Some(WhatsappDeveloperAccount {
                    business_account_id: account.to_string().try_into()?,
                    phone_number_id: phone.to_string().try_into()?,
                    token: AccessToken::new(token.to_string())?,
                    recipients: recipients
                        .as_ref()
                        .split(',')
                        .map(|s| s.trim().trim_start_matches('+').to_owned().try_into())
                        .collect::<Result<_, _>>()?,
                })
            }
            (None, None, None, None) => None,
            _ => anyhow::bail!("configure all four META_WHATSAPP_TEST_* values together"),
        };
        let developer_available = developer.is_some();
        if let Some(developer) = developer {
            provider = provider.with_developer_account(developer)?;
        }
        anyhow::ensure!(
            (wa_id.is_none() && ig_id.is_none() && !developer_available) || kms_key.is_some(),
            "META_CREDENTIAL_KMS_KEY is required for configured Meta accounts"
        );
        // ATTACHMENT_BUCKET already belongs to the email attachment viewer.
        // Its isolated temp/ namespace has a one-day lifecycle rule.
        let temporary_media_bucket = AttachmentBucket::new().map(|v| v.to_string());
        anyhow::ensure!(
            ig_id.is_none() || temporary_media_bucket.is_some(),
            "ATTACHMENT_BUCKET is required for private Instagram media copies"
        );
        let public = PublicConfiguration {
            instagram_human_agent_approved: match MetaInstagramHumanAgentApproved::new()
                .as_ref()
                .map(|value| value.as_ref())
            {
                None | Some("false") => false,
                Some("true") if ig_id.is_some() => true,
                _ => anyhow::bail!(
                    "META_INSTAGRAM_HUMAN_AGENT_APPROVED must be true or false and requires Instagram configuration"
                ),
            },
            whatsapp_app_id: wa_id,
            whatsapp_configuration_id: wa_configuration,
            whatsapp_platform_configuration_id: wa_platform_configuration,
            instagram_app_id: ig_id,
            instagram_redirect_uri: ig_redirect,
            graph_version: "v26.0".into(),
            whatsapp_developer_available: developer_available,
        };
        let webhooks = WebhookConfiguration {
            whatsapp: wa_secret
                .zip(wa_verify)
                .map(|(signature_secret, verify_token)| WebhookCredentials {
                    signature_secret,
                    verify_token,
                }),
            instagram: ig_secret
                .zip(ig_verify)
                .map(|(signature_secret, verify_token)| WebhookCredentials {
                    signature_secret,
                    verify_token,
                }),
        };
        Ok(Self {
            public,
            provider,
            webhooks,
            kms_key,
            temporary_media_bucket,
        })
    }
}
