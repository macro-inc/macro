use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use macro_user_id::user_id::MacroUserIdStr;

use super::UserHotkeyProfilesServiceImpl;
use crate::domain::models::{
    EmailHotkeyProfile, TasksHotkeyProfile, UserHotkeyProfiles, UserHotkeyProfilesError,
};
use crate::domain::ports::{UserHotkeyProfilesRepo, UserHotkeyProfilesService};

const USER: &str = "macro|user@macro.com";
const MISSING_USER: &str = "macro|missing@macro.com";

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

#[derive(Debug, thiserror::Error)]
#[error("fake user hotkey profiles repository error")]
struct FakeRepoError;

/// Users that exist, each with the profiles row they have, if any.
#[derive(Clone, Default)]
struct FakeUserHotkeyProfilesRepo {
    users: Arc<Mutex<HashMap<String, Option<UserHotkeyProfiles>>>>,
    fail: bool,
}

impl FakeUserHotkeyProfilesRepo {
    fn with_user(id: &str) -> Self {
        let repo = Self::default();
        repo.users
            .lock()
            .expect("lock")
            .insert(id.to_string(), None);
        repo
    }
}

impl UserHotkeyProfilesRepo for FakeUserHotkeyProfilesRepo {
    type Err = FakeRepoError;

    async fn get_profiles(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<UserHotkeyProfiles>, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        Ok(self
            .users
            .lock()
            .expect("lock")
            .get(user_id.as_ref())
            .copied()
            .flatten())
    }

    async fn set_profiles(
        &self,
        user_id: &MacroUserIdStr<'_>,
        profiles: UserHotkeyProfiles,
    ) -> Result<bool, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        let mut users = self.users.lock().expect("lock");
        match users.get_mut(user_id.as_ref()) {
            Some(stored) => {
                *stored = Some(profiles);
                Ok(true)
            }
            None => Ok(false),
        }
    }
}

#[tokio::test]
async fn user_without_a_choice_gets_macro_shortcuts() {
    let service = UserHotkeyProfilesServiceImpl::new(FakeUserHotkeyProfilesRepo::with_user(USER));

    assert_eq!(
        service.get_profiles(&user(USER)).await.unwrap(),
        UserHotkeyProfiles {
            email: None,
            tasks: None,
        }
    );
}

#[tokio::test]
async fn sets_and_clears_the_profiles() {
    let service = UserHotkeyProfilesServiceImpl::new(FakeUserHotkeyProfilesRepo::with_user(USER));
    let both = UserHotkeyProfiles {
        email: Some(EmailHotkeyProfile::Superhuman),
        tasks: Some(TasksHotkeyProfile::Linear),
    };

    assert_eq!(service.set_profiles(&user(USER), both).await.unwrap(), both);
    assert_eq!(service.get_profiles(&user(USER)).await.unwrap(), both);

    let email_only = UserHotkeyProfiles {
        email: Some(EmailHotkeyProfile::Superhuman),
        tasks: None,
    };
    service.set_profiles(&user(USER), email_only).await.unwrap();
    assert_eq!(service.get_profiles(&user(USER)).await.unwrap(), email_only);
}

#[tokio::test]
async fn setting_for_a_missing_user_is_not_found() {
    let service = UserHotkeyProfilesServiceImpl::new(FakeUserHotkeyProfilesRepo::with_user(USER));

    assert!(matches!(
        service
            .set_profiles(
                &user(MISSING_USER),
                UserHotkeyProfiles {
                    email: Some(EmailHotkeyProfile::Superhuman),
                    tasks: None,
                },
            )
            .await,
        Err(UserHotkeyProfilesError::UserNotFound)
    ));
}

#[tokio::test]
async fn repository_failure_is_internal() {
    let service = UserHotkeyProfilesServiceImpl::new(FakeUserHotkeyProfilesRepo {
        fail: true,
        ..FakeUserHotkeyProfilesRepo::default()
    });

    assert!(matches!(
        service.get_profiles(&user(USER)).await,
        Err(UserHotkeyProfilesError::Internal(_))
    ));
    assert!(matches!(
        service
            .set_profiles(&user(USER), UserHotkeyProfiles::default())
            .await,
        Err(UserHotkeyProfilesError::Internal(_))
    ));
}
