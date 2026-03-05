use doppleganger::Doppleganger;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::models::{LabelListVisibility, LabelType, MessageListVisibility};

#[derive(Debug, ToSchema, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[dg(backward = MessageListVisibility)]
pub enum ApiMessageListVisibility {
    Show,
    Hide,
}

#[derive(Debug, ToSchema, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[dg(backward = LabelListVisibility)]
pub enum ApiLabelListVisibility {
    LabelShow,
    LabelShowIfUnread,
    LabelHide,
}

#[derive(Debug, ToSchema, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Doppleganger)]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[dg(backward = LabelType)]
pub enum ApiLabelType {
    System,
    User,
}

impl From<MessageListVisibility> for ApiMessageListVisibility {
    fn from(v: MessageListVisibility) -> Self {
        match v {
            MessageListVisibility::Show => ApiMessageListVisibility::Show,
            MessageListVisibility::Hide => ApiMessageListVisibility::Hide,
        }
    }
}

impl From<LabelListVisibility> for ApiLabelListVisibility {
    fn from(v: LabelListVisibility) -> Self {
        match v {
            LabelListVisibility::LabelShow => ApiLabelListVisibility::LabelShow,
            LabelListVisibility::LabelShowIfUnread => ApiLabelListVisibility::LabelShowIfUnread,
            LabelListVisibility::LabelHide => ApiLabelListVisibility::LabelHide,
        }
    }
}

impl From<LabelType> for ApiLabelType {
    fn from(v: LabelType) -> Self {
        match v {
            LabelType::System => ApiLabelType::System,
            LabelType::User => ApiLabelType::User,
        }
    }
}
