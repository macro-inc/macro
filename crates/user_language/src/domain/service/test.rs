use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use macro_user_id::user_id::MacroUserIdStr;
use model_user::Language;

use super::UserLanguageServiceImpl;
use crate::domain::models::UserLanguageError;
use crate::domain::ports::{UserLanguageRepo, UserLanguageService};

const USER: &str = "macro|user@macro.com";
const MISSING_USER: &str = "macro|missing@macro.com";

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

#[derive(Debug, thiserror::Error)]
#[error("fake user language repository error")]
struct FakeRepoError;

#[derive(Clone, Default)]
struct FakeUserLanguageRepo {
    languages: Arc<Mutex<HashMap<String, Option<Language>>>>,
    fail: bool,
}

impl FakeUserLanguageRepo {
    fn with_user(id: &str, language: Option<Language>) -> Self {
        let repo = Self::default();
        repo.languages
            .lock()
            .expect("lock")
            .insert(id.to_string(), language);
        repo
    }
}

impl UserLanguageRepo for FakeUserLanguageRepo {
    type Err = FakeRepoError;

    async fn get_language(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<Option<Language>>, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        Ok(self
            .languages
            .lock()
            .expect("lock")
            .get(user_id.as_ref())
            .copied())
    }

    async fn set_language(
        &self,
        user_id: &MacroUserIdStr<'_>,
        language: Option<Language>,
    ) -> Result<bool, Self::Err> {
        if self.fail {
            return Err(FakeRepoError);
        }
        let mut languages = self.languages.lock().expect("lock");
        match languages.get_mut(user_id.as_ref()) {
            Some(stored) => {
                *stored = language;
                Ok(true)
            }
            None => Ok(false),
        }
    }
}

#[tokio::test]
async fn sets_and_clears_the_language() {
    let service = UserLanguageServiceImpl::new(FakeUserLanguageRepo::with_user(USER, None));

    assert_eq!(service.get_language(&user(USER)).await.unwrap(), None);

    service
        .set_language(&user(USER), Some(Language::Japanese))
        .await
        .unwrap();
    assert_eq!(
        service.get_language(&user(USER)).await.unwrap(),
        Some(Language::Japanese)
    );

    service.set_language(&user(USER), None).await.unwrap();
    assert_eq!(service.get_language(&user(USER)).await.unwrap(), None);
}

#[tokio::test]
async fn missing_user_is_not_found() {
    let service = UserLanguageServiceImpl::new(FakeUserLanguageRepo::with_user(USER, None));

    assert!(matches!(
        service.get_language(&user(MISSING_USER)).await,
        Err(UserLanguageError::UserNotFound)
    ));
    assert!(matches!(
        service
            .set_language(&user(MISSING_USER), Some(Language::German))
            .await,
        Err(UserLanguageError::UserNotFound)
    ));
}

#[tokio::test]
async fn repository_failure_is_internal() {
    let service = UserLanguageServiceImpl::new(FakeUserLanguageRepo {
        fail: true,
        ..FakeUserLanguageRepo::default()
    });

    assert!(matches!(
        service.get_language(&user(USER)).await,
        Err(UserLanguageError::Internal(_))
    ));
}
