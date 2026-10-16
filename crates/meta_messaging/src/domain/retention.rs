//! Retention of delivery envelopes, independently of native source identities.

/// Fully processed receipts keep diagnostic raw content for seven days.
pub const SUCCESSFUL_RAW_DAYS: i32 = 7;
/// Incomplete receipts expire at their original age; completed receipts keep their seven days.
pub const MAX_RECEIPT_DAYS: i32 = 30;
/// Bound each cleanup transaction and its result set.
pub const CLEANUP_BATCH_SIZE: i64 = 500;

/// Content-free counts from one lease-safe cleanup pass.
#[derive(Debug, Default)]
pub struct ReceiptCleanup {
    /// Old completed rows whose unknown completion time was first observed.
    pub completion_times_initialized: u64,
    /// Raw payloads cleared.
    pub payloads_cleared: u64,
    /// Incomplete work explicitly settled at its original retention deadline.
    pub work_expired: u64,
    /// Receipt metadata removed after its original deadline and payload cleanup.
    pub receipts_deleted: u64,
}
impl ReceiptCleanup {
    /// Whether this pass changed anything, so idle maintenance stays quiet.
    pub fn changed(&self) -> bool {
        self.completion_times_initialized
            + self.payloads_cleared
            + self.work_expired
            + self.receipts_deleted
            > 0
    }
}
