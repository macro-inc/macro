//! Adapters implementing the trigger's implicit-evaluation ports.

mod fast_model_judge;
mod lexical_reply_detector;

pub use fast_model_judge::FastModelTriggerJudge;
pub use lexical_reply_detector::LexicalReplyDetector;
