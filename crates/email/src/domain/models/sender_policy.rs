/// Where future mail from a sender lands for one inbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SenderPolicy {
    /// Route the sender's future mail to the Signal view.
    Signal,
    /// Route the sender's future mail to the Noise view.
    Noise,
    /// Trash all future mail from the sender.
    Block,
}
