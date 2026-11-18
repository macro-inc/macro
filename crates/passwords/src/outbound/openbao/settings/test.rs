use super::*;

const KEY_ARN: &str = "arn:aws:kms:us-east-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab";

#[test]
fn no_values_means_no_provider() {
    assert_eq!(openbao_settings(None, None, None, false), Ok(None));
}

#[test]
fn all_three_values_configure_the_provider() {
    assert_eq!(
        openbao_settings(
            Some("https://openbao-dev.macro-internal.com"),
            Some("macro-dev-passwords"),
            Some(KEY_ARN),
            false,
        ),
        Ok(Some(OpenBaoSettings {
            address: "https://openbao-dev.macro-internal.com",
            issuer: "macro-dev-passwords",
            key: KmsKeyId::parse(KEY_ARN, false).expect("key ARN"),
        }))
    );
}

#[test]
fn any_partial_set_is_refused() {
    for (address, issuer, key_id) in [
        (Some("http://openbao:8200"), None, None),
        (None, Some("macro-local-passwords"), None),
        (None, None, Some(KEY_ARN)),
        (
            Some("http://openbao:8200"),
            Some("macro-local-passwords"),
            None,
        ),
        (Some("http://openbao:8200"), None, Some(KEY_ARN)),
        (None, Some("macro-local-passwords"), Some(KEY_ARN)),
    ] {
        assert_eq!(
            openbao_settings(address, issuer, key_id, true),
            Err(SettingsError::Partial),
            "{address:?} {issuer:?} {key_id:?}"
        );
    }
}

#[test]
fn an_alias_is_refused_outside_local_stacks() {
    assert_eq!(
        openbao_settings(
            Some("https://openbao-dev.macro-internal.com"),
            Some("macro-dev-passwords"),
            Some("alias/passwords-jwt-dev"),
            false,
        ),
        Err(SettingsError::KeyId(KmsKeyIdError::NotKeyArn))
    );
    assert!(matches!(
        openbao_settings(
            Some("http://openbao:8200"),
            Some("macro-local-passwords"),
            Some("alias/macro-local-passwords-jwt"),
            true,
        ),
        Ok(Some(_))
    ));
}
