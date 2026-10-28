//! AI toolset for generating and saving images.
mod generate_image;

use crate::domain::ports::ImageGenerationService;
use ai_toolset::AsyncToolCollection;
use bot_id::BotId;
use generate_image::GenerateImage;
use std::sync::Arc;

/// Services and delegated bot identity used by the image-generation tool.
pub struct ImageGenerationToolContext<Svc> {
    /// Image-generation use case.
    pub service: Arc<Svc>,
    /// Bot creating images on behalf of the requesting user.
    pub actor: BotId,
}

impl<Svc> Clone for ImageGenerationToolContext<Svc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            actor: self.actor,
        }
    }
}

impl<Svc> ImageGenerationToolContext<Svc> {
    /// Compose the use case and delegated bot identity.
    pub fn new(service: Svc, actor: BotId) -> Self {
        Self {
            service: Arc::new(service),
            actor,
        }
    }

    /// Set the bot acting on behalf of the requesting user.
    pub fn with_actor(mut self, actor: BotId) -> Self {
        self.actor = actor;
        self
    }
}

/// Image-generation tools shared by chat, agent, and MCP hosts.
pub fn image_generation_toolset<Svc: ImageGenerationService + 'static>()
-> AsyncToolCollection<ImageGenerationToolContext<Svc>> {
    AsyncToolCollection::new().add_tool::<GenerateImage, ImageGenerationToolContext<Svc>>()
}
