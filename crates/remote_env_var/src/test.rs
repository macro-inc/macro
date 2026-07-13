use super::*;

macro_env_var::env_var! {
    #[derive(Debug)]
    struct TestSecretName;
}

#[test]
fn local_or_remote_secret_deserializes_macro_env_var_as_local() {
    let secret = serde_json::from_str::<LocalOrRemoteSecret<TestSecretName>>(r#""secret-name""#)
        .expect("secret should deserialize");

    match secret {
        LocalOrRemoteSecret::Local(value) => assert_eq!(value.as_ref(), "secret-name"),
        LocalOrRemoteSecret::Remote(_) => panic!("deserialized value should be local"),
    }
}

#[test]
fn optional_local_or_remote_secret_deserializes_some_macro_env_var_as_local() {
    let secret =
        serde_json::from_str::<OptionalLocalOrRemoteSecret<TestSecretName>>(r#""secret-name""#)
            .expect("secret should deserialize");

    let Some(LocalOrRemoteSecret::Local(value)) = secret.0 else {
        panic!("deserialized value should be some local secret");
    };

    assert_eq!(value.as_ref(), "secret-name");
}

#[test]
fn optional_local_or_remote_secret_deserializes_null_as_none() {
    let secret = serde_json::from_str::<OptionalLocalOrRemoteSecret<TestSecretName>>("null")
        .expect("secret should deserialize");

    assert!(secret.0.is_none());
}
