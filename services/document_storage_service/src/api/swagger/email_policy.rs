//! Preserve the policy request contract when assembling the public API schema.

use crm::domain::email_policy_api::{EmailPolicyChange, EmailPolicyToken};
use crm::domain::email_rules::EmailInclusionRule;
use utoipa::openapi::schema::AdditionalProperties;
use utoipa::openapi::{OpenApi, RefOr, Schema};
use utoipa::{Modify, ToSchema};

pub(super) struct EmailPolicySchemas;

impl Modify for EmailPolicySchemas {
    fn modify(&self, openapi: &mut OpenApi) {
        let Some(components) = openapi.components.as_mut() else {
            return;
        };
        // The schema derive drops container deny_unknown_fields on tagged enum
        // variants. Keep the generated contract as strict as deserialization.
        for name in [
            EmailInclusionRule::name(),
            EmailPolicyChange::name(),
            EmailPolicyToken::name(),
        ] {
            let Some(RefOr::T(Schema::OneOf(schema))) = components.schemas.get_mut(name.as_ref())
            else {
                continue;
            };
            for variant in &mut schema.items {
                if let RefOr::T(Schema::Object(object)) = variant {
                    object.additional_properties =
                        Some(Box::new(AdditionalProperties::FreeForm(false)));
                }
            }
        }
    }
}
