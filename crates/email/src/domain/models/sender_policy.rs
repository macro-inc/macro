/// Where future mail from a sender lands for one inbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SenderPolicy {
    Signal,
    Noise,
    Block,
}
