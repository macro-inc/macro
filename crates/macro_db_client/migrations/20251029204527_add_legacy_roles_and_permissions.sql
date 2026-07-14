--- This is a bit of a hack because we used to manually insert our roles and permissions
-- now we will have it automated

-- Roles
INSERT INTO "Role" (id,description)
	VALUES ('corporate','Users who negotiated a license outside of stripe'),
        ('partner_sales','Partner of Macro'),
        ('professional_subscriber','User who is subscribed to Professional Tier on Stripe'),
        ('self_serve','Ability to manage stripe subscription'),
        ('super_admin','An employee at macro able to modify org settings'),
        ('organization_it','Is an IT Admin for a given Organization'),
        ('manage_organization_subscription','Ability to manage an organizations stripe subscription'),
        ('email_tool','Ability to use the email tool via macro.com'),
        ('email_tool_on_prem','Ability to use the on prem organization specific email tool via org.com'),
        ('ai_subscriber','Ability to use Macro AI features'),
        ('editor_user','Ability to use the editor feature') ON CONFLICT DO NOTHING;

-- Permissions
INSERT INTO "Permission" (id,description) VALUES
        ('write:stripe_subscription','Allows the user to modify and create stripe subscriptions'),
        ('read:professional_features','Use the premium (paywalled) features in the client app'),
        ('write:release_email','Ability for User to Access and send out release notifications'),
        ('write:admin_panel','Modify and make changes to the admin panel'),
        ('write:enterprise_subscriptions','Modify a stripe subscription for an enterprise organization'),
        ('write:discount','Able to generate discount codes'),
        ('write:it_panel','Able to access the IT Panel for an organization'),
        ('write:email_tool','Able to use the email compare tool'),
        ('write:ai_features','Able to use Macro AI features'),
        ('read:docx_editor','Able to use editor feature') ON CONFLICT DO NOTHING;

-- RolesOnPermissions
INSERT INTO "RolesOnPermissions" ("permissionId","roleId") VALUES
        ('read:professional_features','corporate'),
        ('write:discount','partner_sales'),
        ('read:professional_features','professional_subscriber'),
        ('write:stripe_subscription','self_serve'),
        ('write:admin_panel','super_admin'),
        ('write:release_email','super_admin'),
        ('write:enterprise_subscriptions','super_admin'),
        ('write:it_panel','organization_it'),
        ('write:stripe_subscription','manage_organization_subscription'),
        ('write:email_tool','email_tool'),
        ('write:email_tool','email_tool_on_prem'),
        ('write:ai_features','super_admin'),
        ('write:ai_features','professional_subscriber'),
        ('write:ai_features','ai_subscriber'),
        ('read:docx_editor','editor_user'),
        ('read:docx_editor','self_serve') ON CONFLICT DO NOTHING;
