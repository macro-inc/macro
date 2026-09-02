//! Config options, available commands, and session info: the metadata.

use crate::domain::model::{AvailableCommand, ModelOption};
use agent_client_protocol::schema::MaybeUndefined;
use agent_client_protocol::schema::v1::{
    AvailableCommandInput, AvailableCommandsUpdate as AcpAvailableCommandsUpdate,
    LoadSessionRequest, NewSessionRequest, ResumeSessionRequest, SessionConfigKind,
    SessionConfigOption, SessionConfigSelectOptions, SessionInfoUpdate,
    SetSessionConfigOptionRequest,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use agent_runtime_protocol::domain::action::MODEL_CONFIG_ID;
use serde::Deserialize;

use super::state::FoldState;

impl FoldState {
    /// Remember a request whose response will carry config options.
    pub(super) fn note_config_request(&mut self, frame: &RawJsonRpcMessage) {
        let RawJsonRpcMessage::Request(request) = frame else {
            return;
        };
        let method = &request.method;
        if NewSessionRequest::matches_method(method)
            || LoadSessionRequest::matches_method(method)
            || ResumeSessionRequest::matches_method(method)
            || SetSessionConfigOptionRequest::matches_method(method)
        {
            self.pending_config_requests.insert(request.id.clone());
        }
    }

    /// Read the config options out of a correlated response, whichever
    /// response shape carried them.
    pub(super) fn apply_config_response(&mut self, result: &serde_json::Value) -> bool {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ConfigCarrier {
            #[serde(default)]
            config_options: Vec<SessionConfigOption>,
        }
        match serde_json::from_value::<ConfigCarrier>(result.clone()) {
            Ok(carrier) => self.apply_config_options(carrier.config_options),
            Err(_) => false,
        }
    }

    /// Update the metadata's model fields from a fresh config-options list.
    pub(super) fn apply_config_options(&mut self, options: Vec<SessionConfigOption>) -> bool {
        let model = options
            .into_iter()
            .find(|option| option.id.to_string() == MODEL_CONFIG_ID);
        let Some(SessionConfigOption {
            kind: SessionConfigKind::Select(select),
            ..
        }) = model
        else {
            return false;
        };

        let model = Some(select.current_value.to_string());
        let supported: Vec<ModelOption> = match select.options {
            SessionConfigSelectOptions::Ungrouped(options) => options,
            SessionConfigSelectOptions::Grouped(groups) => {
                groups.into_iter().flat_map(|group| group.options).collect()
            }
            _ => return false,
        }
        .into_iter()
        .map(|option| ModelOption {
            id: option.value.to_string(),
            name: option.name,
            description: option.description,
        })
        .collect();

        let changed = self.metadata.model != model || self.metadata.supported_models != supported;
        self.metadata.model = model;
        self.metadata.supported_models = supported;
        changed
    }

    /// Handle an `available_commands_update`: the advertised slash commands,
    /// carried whole each time, latest wins.
    pub(super) fn apply_available_commands(&mut self, update: AcpAvailableCommandsUpdate) -> bool {
        let commands: Vec<AvailableCommand> = update
            .available_commands
            .into_iter()
            .map(|command| AvailableCommand {
                name: command.name,
                description: command.description,
                input_hint: command.input.and_then(|input| match input {
                    AvailableCommandInput::Unstructured(input) => Some(input.hint),
                    // `#[non_exhaustive]`; unstructured text is the only
                    // input ACP defines, so an unknown shape carries no hint
                    // this fold can show.
                    _ => None,
                }),
            })
            .collect();
        let changed = self.metadata.available_commands != commands;
        self.metadata.available_commands = commands;
        changed
    }

    /// Handle a `session_info_update`: take the title, minding the
    /// absent/null/value distinction - absent means unchanged.
    pub(super) fn apply_session_info(&mut self, update: &SessionInfoUpdate) -> bool {
        let title = match &update.title {
            MaybeUndefined::Undefined => return false,
            MaybeUndefined::Null => None,
            MaybeUndefined::Value(title) => Some(title.clone()),
        };
        let changed = self.metadata.title != title;
        self.metadata.title = title;
        changed
    }
}
