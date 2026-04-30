use attachment::Attachments;

#[derive(Debug)]
pub struct SystemPrompt {
    pub instructions: String,
    pub attachments: Option<Attachments<'static>>,
}
