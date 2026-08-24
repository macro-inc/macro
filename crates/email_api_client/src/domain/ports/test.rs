use super::*;

fn assert_sync_client<T: MailboxSyncClient>() {}
fn assert_subscription_client<T: MailboxSubscriptionClient>() {}
fn assert_message_client<T: MailboxMessageClient>() {}
fn assert_send_client<T: MailboxSendClient>() {}
fn assert_label_client<T: MailboxLabelClient>() {}
fn assert_attachment_client<T: MailboxAttachmentClient>() {}
fn assert_contacts_client<T: MailboxContactsClient>() {}
fn assert_blocklist_client<T: MailboxBlocklistClient>() {}
fn assert_repository<T: EmailApiClientRepository>() {}
fn assert_token_source<T: ProviderTokenSource>() {}
fn assert_rate_limiter<T: ProviderRateLimiter>() {}
fn assert_send_sync_static<T: Send + Sync + 'static>() {}

#[test]
fn no_op_mailbox_implements_every_capability_and_repository() {
    assert_sync_client::<NoOpMailboxClient>();
    assert_subscription_client::<NoOpMailboxClient>();
    assert_message_client::<NoOpMailboxClient>();
    assert_send_client::<NoOpMailboxClient>();
    assert_label_client::<NoOpMailboxClient>();
    assert_attachment_client::<NoOpMailboxClient>();
    assert_contacts_client::<NoOpMailboxClient>();
    assert_blocklist_client::<NoOpMailboxClient>();
    assert_repository::<NoOpMailboxClient>();
    assert_send_sync_static::<NoOpMailboxClient>();
}

#[test]
fn no_op_infrastructure_adapters_implement_their_ports() {
    assert_token_source::<NoOpProviderTokenSource>();
    assert_rate_limiter::<AlwaysAllowRateLimiter>();
    assert_send_sync_static::<NoOpProviderTokenSource>();
    assert_send_sync_static::<AlwaysAllowRateLimiter>();
}
