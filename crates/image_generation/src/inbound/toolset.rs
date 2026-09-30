//! AI toolset for generating and saving images.
mod generate_image;

use crate::domain::ports::ImageGenerationService;
use ai_toolset::AsyncToolCollection;
use bot_id::BotId;
use entity_access::domain::ports::EntityAccessService;
use generate_image::GenerateImage;
use std::sync::Arc;

/// Services and delegated bot identity used by the image-generation tool.
pub struct ImageGenerationToolContext<Svc, Access> {
    /// Image-generation use case.
    pub service: Arc<Svc>,
    /// Inbound access service for minting destination capabilities.
    pub entity_access_service: Arc<Access>,
    /// Bot creating images on behalf of the requesting user.
    pub actor: BotId,
}

impl<Svc, Access> Clone for ImageGenerationToolContext<Svc, Access> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            actor: self.actor,
        }
    }
}

impl<Svc, Access> ImageGenerationToolContext<Svc, Access> {
    /// Compose the use case, access boundary, and delegated bot identity.
    pub fn new(service: Svc, entity_access_service: Arc<Access>, actor: BotId) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service,
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
pub fn image_generation_toolset<
    Svc: ImageGenerationService + 'static,
    Access: EntityAccessService,
>() -> AsyncToolCollection<ImageGenerationToolContext<Svc, Access>> {
    AsyncToolCollection::new().add_tool::<GenerateImage, ImageGenerationToolContext<Svc, Access>>()
}
