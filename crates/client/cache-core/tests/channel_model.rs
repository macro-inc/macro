//! Whatever order a channel's answers, changes and deletes reach the device
//! in, it never shows a deleted message or a stretch that lacks one.

#[path = "support/channel_device.rs"]
mod channel_device;
#[path = "support/channel_model.rs"]
mod channel_model;
#[path = "support/channel_server.rs"]
mod channel_server;

use cache_core::store::InMemoryStorage;
use channel_model::Violation;
use pollster::block_on;
use proptest::prelude::*;

proptest! {
    #[test]
    fn no_order_of_answers_leaves_a_deleted_message_or_a_gap(
        ops in proptest::collection::vec(channel_model::op(), 1..120),
    ) {
        let outcome = block_on(channel_model::run(InMemoryStorage::new(), |storage| storage, &ops));
        if let Err(Violation { wrong, detail }) = outcome {
            return Err(TestCaseError::fail(format!("{wrong:?}: {detail}")));
        }
    }
}
