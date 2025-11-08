//! Contains the models for roles and permissions

use std::{fmt::Display, str::FromStr};

/// All valid roles that exist in our system
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum RoleId {
    /// The professional subscriber role
    ProfessionalSubscriber,
    /// The user is subscribed through a team
    TeamSubscriber,
    /// The corporate role
    Corporate,
    /// The partner sales role
    PartnerSales,
    /// The self serve role
    SelfServe,
    /// The super admin role
    SuperAdmin,
    /// The online subscriber role
    OnlineSubscriber,
    /// The organization it role
    OrganizationIt,
    /// The manage organization subscription role
    ManageOrganizationSubscription,
    /// The email tool role
    EmailTool,
    /// The email tool on prem role
    EmailToolOnPrem,
    /// The ai subscriber role
    AiSubscriber,
    /// The editor user role
    EditorUser,
}

impl Display for RoleId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RoleId::ProfessionalSubscriber => write!(f, "professional_subscriber"),
            RoleId::TeamSubscriber => write!(f, "team_subscriber"),
            RoleId::Corporate => write!(f, "corporate"),
            RoleId::PartnerSales => write!(f, "partner_sales"),
            RoleId::SelfServe => write!(f, "self_serve"),
            RoleId::SuperAdmin => write!(f, "super_admin"),
            RoleId::OnlineSubscriber => write!(f, "online_subscriber"),
            RoleId::OrganizationIt => write!(f, "organization_it"),
            RoleId::ManageOrganizationSubscription => write!(f, "manage_organization_subscription"),
            RoleId::EmailTool => write!(f, "email_tool"),
            RoleId::EmailToolOnPrem => write!(f, "email_tool_on_prem"),
            RoleId::AiSubscriber => write!(f, "ai_subscriber"),
            RoleId::EditorUser => write!(f, "editor_user"),
        }
    }
}

/// All valid permissions that exist in our system
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PermissionId {
    /// Write access to the stripe subscription
    WriteStripeSubscription,
    /// Read access to the professional features
    ReadProfessionalFeatures,
    /// Write access to the release email
    WriteReleaseEmail,
    /// Write access to the admin panel
    WriteAdminPanel,
    /// Write access to the enterprise subscriptions
    WriteEnterpriseSubscriptions,
    /// Write access to the discount
    WriteDiscount,
    /// Write access to the it panel
    WriteItPanel,
    /// Write access to the email tool
    WriteEmailTool,
    /// Write access to the ai features
    WriteAiFeatures,
    /// Read access to the docx editor
    ReadDocxEditor,
}

impl FromStr for PermissionId {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "write:stripe_subscription" => Ok(Self::WriteStripeSubscription),
            "read:professional_features" => Ok(Self::ReadProfessionalFeatures),
            "write:release_email" => Ok(Self::WriteReleaseEmail),
            "write:admin_panel" => Ok(Self::WriteAdminPanel),
            "write:enterprise_subscriptions" => Ok(Self::WriteEnterpriseSubscriptions),
            "write:discount" => Ok(Self::WriteDiscount),
            "write:it_panel" => Ok(Self::WriteItPanel),
            "write:email_tool" => Ok(Self::WriteEmailTool),
            "write:ai_features" => Ok(Self::WriteAiFeatures),
            "read:docx_editor" => Ok(Self::ReadDocxEditor),
            _ => Err(anyhow::anyhow!("invalid permission id {s}")),
        }
    }
}

impl Display for PermissionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PermissionId::WriteStripeSubscription => write!(f, "write:stripe_subscription"),
            PermissionId::ReadProfessionalFeatures => write!(f, "read:professional_features"),
            PermissionId::WriteReleaseEmail => write!(f, "write:release_email"),
            PermissionId::WriteAdminPanel => write!(f, "write:admin_panel"),
            PermissionId::WriteEnterpriseSubscriptions => {
                write!(f, "write:enterprise_subscriptions")
            }
            PermissionId::WriteDiscount => write!(f, "write:discount"),
            PermissionId::WriteItPanel => write!(f, "write:it_panel"),
            PermissionId::WriteEmailTool => write!(f, "write:email_tool"),
            PermissionId::WriteAiFeatures => write!(f, "write:ai_features"),
            PermissionId::ReadDocxEditor => write!(f, "read:docx_editor"),
        }
    }
}

/// A role that contains a set of permissions
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Role {
    id: RoleId,
    description: String,
    permissions: Vec<Permission>,
}

impl Role {
    /// The id of the role
    pub fn id(&self) -> &RoleId {
        &self.id
    }

    /// The description of the role
    pub fn description(&self) -> &str {
        &self.description
    }

    /// The permissions for the role
    pub fn permissions(&self) -> &Vec<Permission> {
        &self.permissions
    }
}

/// A single permission that allows the user to perform various actions
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Permission {
    pub(crate) id: PermissionId,
    pub(crate) description: String,
}

impl Permission {
    /// Creates a new permission
    pub fn new(id: PermissionId, description: String) -> Self {
        Self { id, description }
    }
}

impl Permission {
    /// The id of the permission
    pub fn id(&self) -> &PermissionId {
        &self.id
    }

    /// The description of the permission
    pub fn description(&self) -> &str {
        &self.description
    }
}

/// The subscription status
/// This only contains valid statuses where we have to act on the roles of the user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubscriptionStatus {
    /// The subscription is currently in a trial period and you can safely provision your product for your customer. The subscription transitions automatically to active when a customer makes the first payment.
    Trialing,
    /// The subscription is in good standing. For past_due subscriptions, paying the latest associated invoice or marking it uncollectible transitions the subscription to active. Note that active doesn’t indicate that all outstanding invoices associated with the subscription have been paid. You can leave other outstanding invoices open for payment, mark them as uncollectible, or void them as you see fit.
    Active,
    /// The customer must make a successful payment within 23 hours to activate the subscription. Or the payment requires action, such as customer authentication. Subscriptions can also be incomplete if there’s a pending payment and the PaymentIntent status is processing.
    Incomplete,
    /// The initial payment on the subscription failed and the customer didn’t make a successful payment within 23 hours of subscription creation. These subscriptions don’t bill customers. This status exists so you can track customers that failed to activate their subscriptions.
    IncompleteExpired,
    /// Payment on the latest finalized invoice either failed or wasn’t attempted. The subscription continues to create invoices. Your Dashboard subscription settings determine the subscription’s next status. If the invoice is still unpaid after all attempted smart retries, you can configure the subscription to move to canceled, unpaid, or leave it as past_due. To reactivate the subscription, have your customer pay the most recent invoice. The subscription status becomes active regardless of whether the payment is done before or after the latest invoice due date.
    PastDue,
    /// The subscription was canceled. During cancellation, automatic collection for all unpaid invoices is disabled (auto_advance=false). This is a terminal state that can’t be updated.
    Canceled,
    /// The latest invoice hasn’t been paid but the subscription remains in place. The latest invoice remains open and invoices continue to generate, but payments aren’t attempted. Revoke access to your product when the subscription is unpaid because payments were already attempted and retried while past_due. To move the subscription to active, pay the most recent invoice before its due date.
    Unpaid,
    /// The subscription has ended its trial period without a default payment method and the trial_settings.end_behavior.missing_payment_method is set to pause. Invoices are no longer created for the subscription. After attaching a default payment method to the customer, you can resume the subscription.
    Paused,
}

impl TryFrom<&str> for SubscriptionStatus {
    type Error = anyhow::Error;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "trialing" => Ok(Self::Active),
            "active" => Ok(Self::Active),
            "incomplete" => Ok(Self::Incomplete),
            "incomplete_expired" => Ok(Self::IncompleteExpired),
            "past_due" => Ok(Self::PastDue),
            "canceled" => Ok(Self::Canceled),
            "unpaid" => Ok(Self::Unpaid),
            "paused" => Ok(Self::Paused),
            _ => Err(anyhow::anyhow!("invalid subscription status {value}")),
        }
    }
}

/// Errors that can occur when handling roles and permissions for a user.
#[derive(Debug, thiserror::Error)]
pub enum UserRolesAndPermissionsError {
    /// The user does not exist
    #[error("The user does not exist")]
    UserDoesNotExist,
    /// An error occurred at the storage layer
    #[error("An error occurred at the storage layer {0}")]
    StorageLayerError(#[from] anyhow::Error),
    /// The subscription status is invalid
    #[error("The subscription status {0:?} is invalid")]
    InvalidSubscriptionStatus(SubscriptionStatus),
}
