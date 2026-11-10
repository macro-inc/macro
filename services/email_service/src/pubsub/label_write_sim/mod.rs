//! One Gmail mailbox wired to the production label-write, gmail_ops and inbox
//! sync code, with fake Gmail and SQS endpoints. Its tests replay known races
//! between Macro's label writes, Gmail's answers and syncs, and a seeded
//! simulation checks that sync never undoes an unconfirmed write and that
//! Gmail and the database end on the user's last effective action.

pub(crate) mod fake_gmail;
pub(crate) mod fake_sqs;
mod sim;
mod test;
pub(crate) mod wiring;
pub(crate) mod world;
