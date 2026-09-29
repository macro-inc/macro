use super::{ReturnUrlError, get_plans_handler, validate_return_url};
use crate::domain::PlanTier;

#[test]
fn return_urls_must_be_https_on_the_calling_origin() {
    let origin = Some("https://macro.com");
    assert_eq!(
        validate_return_url("https://macro.com/app/settings/billing?x=1", origin),
        Ok(())
    );
    // Without an Origin header any https URL without credentials passes.
    assert_eq!(
        validate_return_url("https://preview.macro.com/app", None),
        Ok(())
    );
    assert_eq!(
        validate_return_url("http://localhost:3000/app", Some("http://localhost:3000")),
        Ok(())
    );
    assert_eq!(
        validate_return_url("https://macro.com:443/app", origin),
        Ok(())
    );
    assert_eq!(
        validate_return_url("https://macro.com:8443/app", origin),
        Err(ReturnUrlError::Origin)
    );
    assert_eq!(
        validate_return_url("https://evil.example/app", origin),
        Err(ReturnUrlError::Origin)
    );
    assert_eq!(
        validate_return_url("http://macro.com/app", None),
        Err(ReturnUrlError::Scheme)
    );
    assert_eq!(
        validate_return_url("javascript:alert(1)", None),
        Err(ReturnUrlError::Unparseable)
    );
    assert_eq!(
        validate_return_url("/app/settings/billing", None),
        Err(ReturnUrlError::Unparseable)
    );
    assert_eq!(
        validate_return_url("https://user:pw@macro.com/app", None),
        Err(ReturnUrlError::Credentials)
    );
}

#[tokio::test]
async fn plan_catalog_contains_only_free_and_purchasable_paid_plans() {
    let tiers = get_plans_handler()
        .await
        .0
        .plans
        .into_iter()
        .map(|plan| plan.tier)
        .collect::<Vec<_>>();

    assert_eq!(tiers, vec![PlanTier::Free, PlanTier::Premium]);
}
