//! Adapters implementing the trigger's implicit-evaluation ports.

mod channel_thread_history;
mod fast_model_judge;
mod lexical_reply_detector;

pub use channel_thread_history::ChannelThreadHistory;
pub use fast_model_judge::FastModelTriggerJudge;
pub use lexical_reply_detector::LexicalReplyDetector;
