use super::*;

#[test]
fn free_access_is_exact_and_paid_access_preserves_routed_models() {
    let models = [
        FREE_MODEL,
        "anthropic/claude-haiku-4-5",
        "fireworks/kimi-k3",
    ];
    assert_eq!(ModelAccess::Free.models(&models), [FREE_MODEL]);
    assert_eq!(ModelAccess::Paid.models(&models), models);
    assert_eq!(ModelAccess::Free.default_model(models[1]), FREE_MODEL);
    assert_eq!(ModelAccess::Paid.default_model(models[1]), models[1]);
    assert!(!ModelAccess::Free.allows("gemini-3.8-flash"));
    assert!(!ModelAccess::Free.allows("unknown/model"));
}

use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserIdStr};
use roles_and_permissions::domain::model::{
    ProductTier, RoleId, SubscriptionStatus, UserRolesAndPermissionsError,
};
use std::collections::HashSet;

#[derive(Clone)]
struct Permissions(Option<bool>);

impl UserRolesAndPermissionsService for Permissions {
    async fn get_user_permissions(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> Result<HashSet<PermissionId>, UserRolesAndPermissionsError> {
        match self.0 {
            Some(true) => Ok(HashSet::from([PermissionId::ReadProfessionalFeatures])),
            Some(false) => Ok(HashSet::new()),
            None => Err(UserRolesAndPermissionsError::UserDoesNotExist),
        }
    }
    async fn get_user_roles(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> Result<HashSet<RoleId>, UserRolesAndPermissionsError> {
        unreachable!()
    }
    async fn update_user_roles_and_permissions_for_subscription(
        &self,
        _: Email<Lowercase<'_>>,
        _: SubscriptionStatus,
        _: ProductTier,
    ) -> Result<(), UserRolesAndPermissionsError> {
        unreachable!()
    }
    async fn dangerous_upsert_roles_for_user(
        &self,
        _: &MacroUserIdStr<'_>,
        _: non_empty::NonEmpty<&[RoleId]>,
    ) -> Result<(), UserRolesAndPermissionsError> {
        unreachable!()
    }
    async fn dangerous_remove_roles_from_user(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &non_empty::NonEmpty<&[RoleId]>,
    ) -> Result<(), UserRolesAndPermissionsError> {
        unreachable!()
    }
}

#[tokio::test]
async fn permissions_determine_access_and_lookup_errors_fail_closed() {
    let owner = Owner::User(MacroUserIdStr::try_from_email("owner@macro.com").unwrap());
    for (paid, expected) in [(false, ModelAccess::Free), (true, ModelAccess::Paid)] {
        let policy = PermissionModelAccess::new(Permissions(Some(paid)));
        assert_eq!(policy.access(&owner).await.unwrap(), expected);
    }
    assert!(matches!(
        PermissionModelAccess::new(Permissions(None))
            .access(&owner)
            .await,
        Err(ModelAccessError::Unavailable)
    ));
}

#[tokio::test]
async fn non_user_owners_cannot_bypass_model_access() {
    let policy = PermissionModelAccess::new(Permissions(Some(true)));
    assert!(matches!(
        policy.access(&Owner::Bot(bot_id::MACRO_NEW_BOT_ID)).await,
        Err(ModelAccessError::Unavailable)
    ));
}

#[test]
fn an_agents_key_replaces_the_plan_with_its_providers_models() {
    let supported = [
        "anthropic/claude-sonnet-5-5",
        "openai/gpt-6-astra",
        FREE_MODEL,
    ];
    let keyed = SessionModels::new(
        ModelAccess::Free,
        Some(agent_api_keys::domain::ModelProvider::Anthropic),
    );
    assert_eq!(keyed.models(&supported), ["anthropic/claude-sonnet-5-5"]);
    assert!(!keyed.allows(FREE_MODEL));
    assert_eq!(
        keyed.default_model("anthropic/claude-sonnet-5-5", &supported),
        "anthropic/claude-sonnet-5-5",
        "a free plan does not clamp a model the agent's key pays for"
    );
    assert_eq!(
        keyed.default_model("openai/gpt-6-astra", &supported),
        "anthropic/claude-sonnet-5-5",
        "a model saved before the key moves to one the key can run"
    );

    let plan = SessionModels::new(ModelAccess::Free, None);
    assert_eq!(plan.models(&supported), [FREE_MODEL]);
    assert_eq!(
        plan.default_model("anthropic/claude-sonnet-5-5", &supported),
        FREE_MODEL
    );
}
