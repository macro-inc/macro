use super::*;
use feature_flags::outbound::fake::FakeFeatureFlags;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

#[tokio::test]
async fn service_authority_is_required_for_humans_and_actorless_operations() {
    for configured in [false, true] {
        for result in [
            Ok(FlagSnapshot::new([(
                PASSWORDS_FLAG.into(),
                FlagValue::Boolean(false),
            )])),
            Ok(FlagSnapshot::default()),
            Err("remote evaluation failed".to_owned()),
            Ok(FlagSnapshot::new([(
                PASSWORDS_FLAG.into(),
                FlagValue::Boolean(true),
            )])),
        ] {
            let expected = match &result {
                Err(_) => "unavailable",
                Ok(snapshot) if !snapshot.is_enabled(PASSWORDS_FLAG) => "not_found",
                Ok(_) if !configured => "unavailable",
                Ok(_) => "enabled",
            };
            let mut flags = FakeFeatureFlags::default();
            flags.set_service(PASSWORDS_CONTEXT, result);
            // An enabled actor never overrides service denial.
            let user = MacroUserIdStr::parse_from_str("macro|human@example.com")
                .unwrap()
                .into_owned();
            flags.set(
                user.clone(),
                Ok(FlagSnapshot::new([(
                    PASSWORDS_FLAG.into(),
                    FlagValue::Boolean(true),
                )])),
            );
            let availability = PasswordAvailability {
                flags,
                provider_configured: configured,
            };
            for result in [
                availability.require_enabled(&Actor { user_id: user }).await,
                availability.require_service_enabled().await,
            ] {
                match expected {
                    "enabled" => assert!(result.is_ok()),
                    "not_found" => assert!(matches!(result, Err(Error::NotFound))),
                    _ => assert!(matches!(result, Err(Error::Unavailable))),
                }
            }
        }
    }
}

#[tokio::test]
async fn old_key_and_wrong_service_context_cannot_enable_the_vault() {
    let mut flags = FakeFeatureFlags::default();
    flags.set_service(
        PASSWORDS_CONTEXT,
        Ok(FlagSnapshot::new([(
            "enable-passwords".into(),
            FlagValue::Boolean(true),
        )])),
    );
    let availability = PasswordAvailability {
        flags,
        provider_configured: true,
    };
    assert!(matches!(
        availability.require_service_enabled().await,
        Err(Error::NotFound)
    ));
    let mut flags = FakeFeatureFlags::default();
    flags.set_service(
        ServiceContext::new("different-service"),
        Ok(FlagSnapshot::new([(
            PASSWORDS_FLAG.into(),
            FlagValue::Boolean(true),
        )])),
    );
    let availability = PasswordAvailability {
        flags,
        provider_configured: true,
    };
    assert!(matches!(
        availability.require_service_enabled().await,
        Err(Error::Unavailable)
    ));
}

#[tokio::test]
async fn human_admission_requires_both_service_and_actor_targeting() {
    let user = MacroUserIdStr::parse_from_str("macro|human@example.com")
        .unwrap()
        .into_owned();
    for service_on in [false, true] {
        for configured in [false, true] {
            for actor_result in [
                Ok(FlagSnapshot::new([(
                    PASSWORDS_FLAG.into(),
                    FlagValue::Boolean(true),
                )])),
                Ok(FlagSnapshot::new([(
                    PASSWORDS_FLAG.into(),
                    FlagValue::Boolean(false),
                )])),
                Ok(FlagSnapshot::default()),
                Err("actor remote failure".to_owned()),
            ] {
                let mut flags = FakeFeatureFlags::default();
                flags.set_service(
                    PASSWORDS_CONTEXT,
                    Ok(FlagSnapshot::new([(
                        PASSWORDS_FLAG.into(),
                        FlagValue::Boolean(service_on),
                    )])),
                );
                let actor_enabled = actor_result
                    .as_ref()
                    .is_ok_and(|snapshot| snapshot.is_enabled(PASSWORDS_FLAG));
                let actor_failed = actor_result.is_err();
                flags.set(user.clone(), actor_result);
                let availability = PasswordAvailability {
                    flags,
                    provider_configured: configured,
                };
                let human = availability
                    .require_enabled(&Actor {
                        user_id: user.clone(),
                    })
                    .await;
                if !service_on {
                    assert!(matches!(human, Err(Error::NotFound)));
                } else if !configured || actor_failed {
                    assert!(matches!(human, Err(Error::Unavailable)));
                } else if !actor_enabled {
                    assert!(matches!(human, Err(Error::NotFound)));
                } else {
                    assert!(human.is_ok());
                }
                let background = availability.require_service_enabled().await;
                assert_eq!(
                    background.is_ok(),
                    service_on && configured,
                    "jobs are independent of actor targeting"
                );
            }
        }
    }
}
