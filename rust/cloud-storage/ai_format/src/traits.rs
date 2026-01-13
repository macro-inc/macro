pub trait TextAttachment: std::fmt::Display + std::fmt::Debug + Send + Sync {}

impl TextAttachment for Box<dyn TextAttachment> {}
