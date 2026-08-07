#[cfg(not(feature = "unstable_protocol_v2"))]
mod imp {
    #![allow(clippy::unused_self, clippy::unnecessary_wraps)]
    use crate::UntypedMessage;

    #[derive(Clone, Copy, Debug, Default)]
    pub(crate) struct ProtocolMode;

    impl ProtocolMode {
        pub(crate) fn disabled() -> Self {
            Self
        }

        pub(crate) fn v1_agent() -> Self {
            Self
        }

        pub(crate) fn v1_client() -> Self {
            Self
        }

        pub(crate) fn merge(self, _other: Self) -> Self {
            self
        }
    }

    #[derive(Clone, Debug, Default)]
    pub(crate) struct ProtocolCompat;

    impl ProtocolCompat {
        pub(crate) fn new(_mode: ProtocolMode) -> Self {
            Self
        }

        pub(crate) fn incoming_message(
            &self,
            message: UntypedMessage,
        ) -> Result<UntypedMessage, crate::Error> {
            Ok(message)
        }

        pub(crate) fn outgoing_message(
            &self,
            message: UntypedMessage,
        ) -> Result<UntypedMessage, crate::Error> {
            Ok(message)
        }

        pub(crate) fn incoming_notification(
            &self,
            message: UntypedMessage,
        ) -> Result<Vec<UntypedMessage>, crate::Error> {
            Ok(vec![message])
        }

        pub(crate) fn outgoing_notification(
            &self,
            message: UntypedMessage,
        ) -> Result<Vec<UntypedMessage>, crate::Error> {
            Ok(vec![message])
        }

        pub(crate) fn incoming_response(
            &self,
            _method: &str,
            result: Result<serde_json::Value, crate::Error>,
        ) -> Result<serde_json::Value, crate::Error> {
            result
        }

        pub(crate) fn outgoing_response(
            &self,
            _method: &str,
            result: Result<serde_json::Value, crate::Error>,
        ) -> Result<serde_json::Value, crate::Error> {
            result
        }
    }
}

#[cfg(feature = "unstable_protocol_v2")]
mod imp {
    use std::sync::{Arc, Mutex};

    use agent_client_protocol_schema::v2::{
        self,
        conversion::{IntoV1, IntoV1Many, IntoV2, v1_to_v2, v2_to_v1, v2_to_v1_many},
    };

    use crate::schema::ProtocolVersion;
    use crate::schema::v1::{
        AgentNotification, AgentRequest, AgentResponse, ClientNotification, ClientRequest,
        ClientResponse, ErrorCode,
    };
    use crate::{JsonRpcMessage, JsonRpcResponse, UntypedMessage};

    #[derive(Clone, Copy, Debug)]
    pub(crate) enum ProtocolMode {
        Disabled,
        Acp(AcpProtocolMode),
    }

    #[derive(Clone, Copy, Debug)]
    pub(crate) struct AcpProtocolMode {
        api: ProtocolVersionKind,
        latest_supported: ProtocolVersionKind,
        require_latest_response: bool,
    }

    impl ProtocolMode {
        pub(crate) fn disabled() -> Self {
            Self::Disabled
        }

        pub(crate) fn v1_agent() -> Self {
            Self::Acp(AcpProtocolMode {
                api: ProtocolVersionKind::V1,
                latest_supported: ProtocolVersionKind::V1,
                require_latest_response: false,
            })
        }

        pub(crate) fn v1_client() -> Self {
            Self::Acp(AcpProtocolMode {
                api: ProtocolVersionKind::V1,
                latest_supported: ProtocolVersionKind::V1,
                require_latest_response: true,
            })
        }

        pub(crate) fn v2_agent() -> Self {
            Self::Acp(AcpProtocolMode {
                api: ProtocolVersionKind::V2,
                latest_supported: ProtocolVersionKind::V2,
                require_latest_response: false,
            })
        }

        pub(crate) fn v2_client() -> Self {
            Self::Acp(AcpProtocolMode {
                api: ProtocolVersionKind::V2,
                latest_supported: ProtocolVersionKind::V2,
                require_latest_response: true,
            })
        }

        pub(crate) fn merge(self, other: Self) -> Self {
            match (self, other) {
                (Self::Disabled, other) => other,
                (this, Self::Disabled) => this,
                (Self::Acp(this), Self::Acp(other)) => {
                    assert_eq!(
                        this.api, other.api,
                        "cannot merge ACP builders with different API protocol versions; \
                         handler chains share a single API surface",
                    );
                    if this.latest_supported >= other.latest_supported {
                        Self::Acp(this)
                    } else {
                        Self::Acp(other)
                    }
                }
            }
        }
    }

    #[derive(Clone, Debug)]
    pub(crate) struct ProtocolCompat {
        mode: Option<AcpProtocolMode>,
        state: Arc<Mutex<ProtocolState>>,
    }

    #[derive(Debug)]
    struct ProtocolState {
        negotiated: ProtocolVersionKind,
        pending_initialize: Option<ProtocolVersionKind>,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
    enum ProtocolVersionKind {
        V1,
        V2,
    }

    impl ProtocolVersionKind {
        fn as_protocol_version(self) -> ProtocolVersion {
            match self {
                Self::V1 => ProtocolVersion::V1,
                Self::V2 => ProtocolVersion::V2,
            }
        }

        fn from_protocol_version(version: ProtocolVersion) -> Option<Self> {
            if version == ProtocolVersion::V1 {
                Some(Self::V1)
            } else if version == ProtocolVersion::V2 {
                Some(Self::V2)
            } else {
                None
            }
        }
    }

    impl ProtocolCompat {
        pub(crate) fn new(mode: ProtocolMode) -> Self {
            Self {
                mode: match mode {
                    ProtocolMode::Disabled => None,
                    ProtocolMode::Acp(mode) => Some(mode),
                },
                state: Arc::new(Mutex::new(ProtocolState {
                    negotiated: ProtocolVersionKind::V1,
                    pending_initialize: None,
                })),
            }
        }

        pub(crate) fn incoming_message(
            &self,
            message: UntypedMessage,
        ) -> Result<UntypedMessage, crate::Error> {
            let Some(mode) = self.mode else {
                return Ok(message);
            };

            if message.method() == "initialize" {
                return self.incoming_initialize_request(mode, message);
            }

            convert_message(message, self.active_wire_version(), mode.api)
        }

        pub(crate) fn outgoing_message(
            &self,
            mut message: UntypedMessage,
        ) -> Result<UntypedMessage, crate::Error> {
            let Some(mode) = self.mode else {
                return Ok(message);
            };

            let wire_version = if message.method() == "initialize" {
                set_protocol_version(&mut message.params, mode.latest_supported)?;
                self.set_pending_initialize(mode.latest_supported);
                mode.latest_supported
            } else {
                self.active_wire_version()
            };

            convert_message(message, mode.api, wire_version)
        }

        pub(crate) fn incoming_notification(
            &self,
            message: UntypedMessage,
        ) -> Result<Vec<UntypedMessage>, crate::Error> {
            let Some(mode) = self.mode else {
                return Ok(vec![message]);
            };

            convert_notification(message, self.active_wire_version(), mode.api)
        }

        pub(crate) fn outgoing_notification(
            &self,
            message: UntypedMessage,
        ) -> Result<Vec<UntypedMessage>, crate::Error> {
            let Some(mode) = self.mode else {
                return Ok(vec![message]);
            };

            convert_notification(message, mode.api, self.active_wire_version())
        }

        pub(crate) fn incoming_response(
            &self,
            method: &str,
            result: Result<serde_json::Value, crate::Error>,
        ) -> Result<serde_json::Value, crate::Error> {
            let Some(mode) = self.mode else {
                return result;
            };

            if method == "initialize" {
                return self.incoming_initialize_response(mode, result);
            }

            let value = result?;
            convert_response(method, value, self.active_wire_version(), mode.api)
        }

        pub(crate) fn outgoing_response(
            &self,
            method: &str,
            result: Result<serde_json::Value, crate::Error>,
        ) -> Result<serde_json::Value, crate::Error> {
            let Some(mode) = self.mode else {
                return result;
            };

            // Always drain any pending initialize state so a failed initialize
            // doesn't leak negotiation state to a subsequent request.
            let pending_initialize = if method == "initialize" {
                self.take_pending_initialize()
            } else {
                None
            };

            let mut value = result?;

            let wire_version = if method == "initialize" {
                let negotiated = pending_initialize.unwrap_or_else(|| {
                    protocol_version_from_value(&value)
                        .and_then(ProtocolVersionKind::from_protocol_version)
                        .unwrap_or(mode.latest_supported)
                });
                set_protocol_version(&mut value, negotiated)?;
                self.set_negotiated(negotiated);
                negotiated
            } else {
                self.active_wire_version()
            };

            convert_response(method, value, mode.api, wire_version)
        }

        fn incoming_initialize_request(
            &self,
            mode: AcpProtocolMode,
            mut message: UntypedMessage,
        ) -> Result<UntypedMessage, crate::Error> {
            let requested = required_protocol_version_from_value(message.params())?;
            let requested_kind = ProtocolVersionKind::from_protocol_version(requested);
            let wire_version = requested_kind.unwrap_or(mode.latest_supported);
            let negotiated = self.negotiate(requested);
            self.set_pending_initialize(negotiated);

            message = convert_message(message, wire_version, mode.api)?;
            set_protocol_version(&mut message.params, mode.api)?;
            Ok(message)
        }

        fn incoming_initialize_response(
            &self,
            mode: AcpProtocolMode,
            result: Result<serde_json::Value, crate::Error>,
        ) -> Result<serde_json::Value, crate::Error> {
            let _pending_initialize = self.take_pending_initialize();
            let mut value = result?;
            let response_version = required_protocol_version_from_value(&value)?;
            if !self.supports(response_version) {
                return Err(unsupported_protocol_version(response_version));
            }

            let wire_version = ProtocolVersionKind::from_protocol_version(response_version)
                .ok_or_else(|| unsupported_protocol_version(response_version))?;
            if mode.require_latest_response && wire_version != mode.latest_supported {
                return Err(required_protocol_version(
                    mode.latest_supported,
                    wire_version,
                ));
            }
            self.set_negotiated(wire_version);

            value = convert_response("initialize", value, wire_version, mode.api)?;
            set_protocol_version(&mut value, wire_version)?;
            Ok(value)
        }

        fn supports(&self, version: ProtocolVersion) -> bool {
            let Some(mode) = self.mode else {
                return false;
            };

            version == ProtocolVersion::V1
                || (mode.latest_supported == ProtocolVersionKind::V2
                    && version == ProtocolVersion::V2)
        }

        fn negotiate(&self, requested: ProtocolVersion) -> ProtocolVersionKind {
            let mode = self
                .mode
                .expect("ACP protocol mode should be enabled while negotiating");

            if self.supports(requested) {
                ProtocolVersionKind::from_protocol_version(requested)
                    .unwrap_or(mode.latest_supported)
            } else {
                mode.latest_supported
            }
        }

        fn active_wire_version(&self) -> ProtocolVersionKind {
            let state = self
                .state
                .lock()
                .expect("protocol compatibility state mutex poisoned");
            state.pending_initialize.unwrap_or(state.negotiated)
        }

        fn set_negotiated(&self, negotiated: ProtocolVersionKind) {
            self.state
                .lock()
                .expect("protocol compatibility state mutex poisoned")
                .negotiated = negotiated;
        }

        fn set_pending_initialize(&self, negotiated: ProtocolVersionKind) {
            self.state
                .lock()
                .expect("protocol compatibility state mutex poisoned")
                .pending_initialize = Some(negotiated);
        }

        fn take_pending_initialize(&self) -> Option<ProtocolVersionKind> {
            self.state
                .lock()
                .expect("protocol compatibility state mutex poisoned")
                .pending_initialize
                .take()
        }
    }

    fn protocol_version_from_value(value: &serde_json::Value) -> Option<ProtocolVersion> {
        serde_json::from_value(value.get("protocolVersion")?.clone()).ok()
    }

    fn required_protocol_version_from_value(
        value: &serde_json::Value,
    ) -> Result<ProtocolVersion, crate::Error> {
        let Some(version) = value.get("protocolVersion") else {
            return Err(invalid_initialize_protocol_version());
        };

        serde_json::from_value(version.clone()).map_err(|_| invalid_initialize_protocol_version())
    }

    fn invalid_initialize_protocol_version() -> crate::Error {
        crate::Error::invalid_params()
            .data("initialize.protocolVersion must be a valid ACP protocol version")
    }

    fn set_protocol_version(
        value: &mut serde_json::Value,
        version: ProtocolVersionKind,
    ) -> Result<(), crate::Error> {
        if let serde_json::Value::Object(object) = value {
            object.insert(
                "protocolVersion".into(),
                serde_json::to_value(version.as_protocol_version())
                    .map_err(crate::Error::into_internal_error)?,
            );
        }
        Ok(())
    }

    fn convert_message(
        message: UntypedMessage,
        from: ProtocolVersionKind,
        to: ProtocolVersionKind,
    ) -> Result<UntypedMessage, crate::Error> {
        if message.method().starts_with('_') || from == to {
            return Ok(message);
        }

        match (from, to) {
            (ProtocolVersionKind::V1, ProtocolVersionKind::V2) => public_to_v2_message(message),
            (ProtocolVersionKind::V2, ProtocolVersionKind::V1) => v2_to_public_message(message),
            _ => Ok(message),
        }
    }

    fn convert_response(
        method: &str,
        value: serde_json::Value,
        from: ProtocolVersionKind,
        to: ProtocolVersionKind,
    ) -> Result<serde_json::Value, crate::Error> {
        if method.starts_with('_') || from == to {
            return Ok(value);
        }

        match (from, to) {
            (ProtocolVersionKind::V1, ProtocolVersionKind::V2) => {
                public_to_v2_response(method, value)
            }
            (ProtocolVersionKind::V2, ProtocolVersionKind::V1) => {
                v2_to_public_response(method, value)
            }
            _ => Ok(value),
        }
    }

    fn convert_notification(
        message: UntypedMessage,
        from: ProtocolVersionKind,
        to: ProtocolVersionKind,
    ) -> Result<Vec<UntypedMessage>, crate::Error> {
        if message.method().starts_with('_') || from == to {
            return Ok(vec![message]);
        }

        match (from, to) {
            (ProtocolVersionKind::V1, ProtocolVersionKind::V2) => {
                public_to_v2_notification(message)
            }
            (ProtocolVersionKind::V2, ProtocolVersionKind::V1) => {
                v2_to_public_notification(message)
            }
            _ => Ok(vec![message]),
        }
    }

    fn public_to_v2_notification(
        message: UntypedMessage,
    ) -> Result<Vec<UntypedMessage>, crate::Error> {
        public_to_v2_message(message).map(|message| vec![message])
    }

    fn v2_to_public_notification(
        message: UntypedMessage,
    ) -> Result<Vec<UntypedMessage>, crate::Error> {
        let UntypedMessage { method, params } = message;

        if let Some(message) =
            try_convert_message_to_v1::<v2::ClientNotification>(&method, &params)?
        {
            return Ok(vec![message]);
        }
        if let Some(messages) =
            try_convert_message_to_v1_many::<v2::AgentNotification>(&method, &params)?
        {
            return Ok(messages);
        }

        Ok(vec![UntypedMessage { method, params }])
    }

    fn public_to_v2_message(message: UntypedMessage) -> Result<UntypedMessage, crate::Error> {
        let UntypedMessage { method, params } = message;

        if let Some(message) = try_convert_message_to_v2::<ClientRequest>(&method, &params)? {
            return Ok(message);
        }
        if let Some(message) = try_convert_message_to_v2::<AgentRequest>(&method, &params)? {
            return Ok(message);
        }
        if let Some(message) = try_convert_message_to_v2::<ClientNotification>(&method, &params)? {
            return Ok(message);
        }
        if let Some(message) = try_convert_message_to_v2::<AgentNotification>(&method, &params)? {
            return Ok(message);
        }

        Ok(UntypedMessage { method, params })
    }

    fn v2_to_public_message(message: UntypedMessage) -> Result<UntypedMessage, crate::Error> {
        let UntypedMessage { method, params } = message;

        if let Some(message) = try_convert_message_to_v1::<v2::ClientRequest>(&method, &params)? {
            return Ok(message);
        }
        if let Some(message) = try_convert_message_to_v1::<v2::AgentRequest>(&method, &params)? {
            return Ok(message);
        }
        if let Some(message) =
            try_convert_message_to_v1::<v2::ClientNotification>(&method, &params)?
        {
            return Ok(message);
        }
        Ok(UntypedMessage { method, params })
    }

    fn public_to_v2_response(
        method: &str,
        value: serde_json::Value,
    ) -> Result<serde_json::Value, crate::Error> {
        if let Some(value) = try_convert_response_to_v2::<AgentResponse>(method, &value)? {
            return Ok(value);
        }
        if let Some(value) = try_convert_response_to_v2::<ClientResponse>(method, &value)? {
            return Ok(value);
        }

        Ok(value)
    }

    fn v2_to_public_response(
        method: &str,
        value: serde_json::Value,
    ) -> Result<serde_json::Value, crate::Error> {
        if let Some(value) = try_convert_response_to_v1::<v2::AgentResponse>(method, &value)? {
            return Ok(value);
        }
        if let Some(value) = try_convert_response_to_v1::<v2::ClientResponse>(method, &value)? {
            return Ok(value);
        }

        Ok(value)
    }

    fn try_convert_message_to_v2<T>(
        method: &str,
        params: &serde_json::Value,
    ) -> Result<Option<UntypedMessage>, crate::Error>
    where
        T: JsonRpcMessage + IntoV2,
        T::Output: JsonRpcMessage,
    {
        let Some(message) = try_parse_message::<T>(method, params)? else {
            return Ok(None);
        };
        let wire_message = v1_to_v2(message)?;
        wire_message.to_untyped_message().map(Some)
    }

    fn try_convert_message_to_v1<T>(
        method: &str,
        params: &serde_json::Value,
    ) -> Result<Option<UntypedMessage>, crate::Error>
    where
        T: JsonRpcMessage + IntoV1,
        T::Output: JsonRpcMessage,
    {
        let Some(message) = try_parse_message::<T>(method, params)? else {
            return Ok(None);
        };
        let public_message = v2_to_v1(message)?;
        public_message.to_untyped_message().map(Some)
    }

    fn try_convert_message_to_v1_many<T>(
        method: &str,
        params: &serde_json::Value,
    ) -> Result<Option<Vec<UntypedMessage>>, crate::Error>
    where
        T: JsonRpcMessage + IntoV1Many,
        T::Output: JsonRpcMessage,
    {
        let Some(message) = try_parse_message::<T>(method, params)? else {
            return Ok(None);
        };
        v2_to_v1_many(message)?
            .into_iter()
            .map(|public_message| public_message.to_untyped_message())
            .collect::<Result<Vec<_>, _>>()
            .map(Some)
    }

    fn try_parse_message<T: JsonRpcMessage>(
        method: &str,
        params: &serde_json::Value,
    ) -> Result<Option<T>, crate::Error> {
        match T::parse_message(method, params) {
            Ok(message) => Ok(Some(message)),
            Err(error) if error.code == ErrorCode::MethodNotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn try_convert_response_to_v2<T>(
        method: &str,
        value: &serde_json::Value,
    ) -> Result<Option<serde_json::Value>, crate::Error>
    where
        T: JsonRpcResponse + IntoV2,
        T::Output: JsonRpcResponse,
    {
        let Some(response) = try_parse_response::<T>(method, value)? else {
            return Ok(None);
        };
        let wire_response = v1_to_v2(response)?;
        wire_response.into_json(method).map(Some)
    }

    fn try_convert_response_to_v1<T>(
        method: &str,
        value: &serde_json::Value,
    ) -> Result<Option<serde_json::Value>, crate::Error>
    where
        T: JsonRpcResponse + IntoV1,
        T::Output: JsonRpcResponse,
    {
        let Some(response) = try_parse_response::<T>(method, value)? else {
            return Ok(None);
        };
        let public_response = v2_to_v1(response)?;
        public_response.into_json(method).map(Some)
    }

    fn try_parse_response<T: JsonRpcResponse>(
        method: &str,
        value: &serde_json::Value,
    ) -> Result<Option<T>, crate::Error> {
        match T::from_value(method, value.clone()) {
            Ok(response) => Ok(Some(response)),
            Err(error) if error.code == ErrorCode::MethodNotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn unsupported_protocol_version(version: ProtocolVersion) -> crate::Error {
        crate::Error::invalid_request().data(format!(
            "unsupported ACP protocol version {version}; this endpoint does not support that version"
        ))
    }

    fn required_protocol_version(
        required: ProtocolVersionKind,
        negotiated: ProtocolVersionKind,
    ) -> crate::Error {
        crate::Error::invalid_request().data(format!(
            "required ACP protocol version {} but peer negotiated {}; use a v1 client implementation for v1 agents",
            required.as_protocol_version(),
            negotiated.as_protocol_version(),
        ))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn negotiated(compat: &ProtocolCompat) -> ProtocolVersionKind {
            compat
                .state
                .lock()
                .expect("protocol compatibility state mutex poisoned")
                .negotiated
        }

        fn v2_implementation() -> v2::Implementation {
            v2::Implementation::new("protocol-compat-test", env!("CARGO_PKG_VERSION"))
        }

        fn v2_initialize_request(protocol_version: ProtocolVersion) -> v2::InitializeRequest {
            v2::InitializeRequest::new(protocol_version, v2_implementation())
        }

        fn v2_initialize_response(protocol_version: ProtocolVersion) -> v2::InitializeResponse {
            v2::InitializeResponse::new(protocol_version, v2_implementation())
        }

        #[test]
        fn initialize_request_sets_active_wire_version_before_response() -> Result<(), crate::Error>
        {
            let compat = ProtocolCompat::new(ProtocolMode::v2_agent());
            assert_eq!(compat.active_wire_version(), ProtocolVersionKind::V1);

            compat.incoming_message(UntypedMessage::new(
                "initialize",
                v2_initialize_request(ProtocolVersion::V2),
            )?)?;

            assert_eq!(negotiated(&compat), ProtocolVersionKind::V1);
            assert_eq!(compat.active_wire_version(), ProtocolVersionKind::V2);

            compat.outgoing_response(
                "initialize",
                Ok(serde_json::to_value(v2_initialize_response(
                    ProtocolVersion::V2,
                ))?),
            )?;

            assert_eq!(negotiated(&compat), ProtocolVersionKind::V2);
            assert_eq!(compat.active_wire_version(), ProtocolVersionKind::V2);
            Ok(())
        }

        #[test]
        fn outgoing_initialize_sets_active_wire_version_before_response() -> Result<(), crate::Error>
        {
            let compat = ProtocolCompat::new(ProtocolMode::v2_client());
            assert_eq!(compat.active_wire_version(), ProtocolVersionKind::V1);

            compat.outgoing_message(UntypedMessage::new(
                "initialize",
                v2_initialize_request(ProtocolVersion::V1),
            )?)?;

            assert_eq!(negotiated(&compat), ProtocolVersionKind::V1);
            assert_eq!(compat.active_wire_version(), ProtocolVersionKind::V2);

            compat.incoming_response(
                "initialize",
                Ok(serde_json::to_value(v2_initialize_response(
                    ProtocolVersion::V2,
                ))?),
            )?;

            assert_eq!(negotiated(&compat), ProtocolVersionKind::V2);
            assert_eq!(compat.active_wire_version(), ProtocolVersionKind::V2);
            Ok(())
        }

        #[test]
        fn failed_incoming_initialize_response_clears_pending_wire_version()
        -> Result<(), crate::Error> {
            let compat = ProtocolCompat::new(ProtocolMode::v2_client());
            assert_eq!(compat.active_wire_version(), ProtocolVersionKind::V1);

            compat.outgoing_message(UntypedMessage::new(
                "initialize",
                v2_initialize_request(ProtocolVersion::V1),
            )?)?;

            assert_eq!(negotiated(&compat), ProtocolVersionKind::V1);
            assert_eq!(compat.active_wire_version(), ProtocolVersionKind::V2);

            let result = compat.incoming_response(
                "initialize",
                Err(crate::Error::invalid_request().data("initialize failed")),
            );

            assert!(result.is_err());
            assert_eq!(negotiated(&compat), ProtocolVersionKind::V1);
            assert_eq!(compat.active_wire_version(), ProtocolVersionKind::V1);
            Ok(())
        }

        #[test]
        fn incoming_initialize_response_requires_protocol_version() -> Result<(), crate::Error> {
            for value in [
                serde_json::json!({}),
                serde_json::json!({ "protocolVersion": 100_000 }),
            ] {
                let compat = ProtocolCompat::new(ProtocolMode::v2_client());
                compat.outgoing_message(UntypedMessage::new(
                    "initialize",
                    v2_initialize_request(ProtocolVersion::V1),
                )?)?;

                let error = compat
                    .incoming_response("initialize", Ok(value))
                    .expect_err("initialize responses must declare an ACP protocol version");
                let data = error
                    .data
                    .as_ref()
                    .and_then(|data| data.as_str())
                    .unwrap_or_default();
                assert!(data.contains("protocolVersion"), "{error:?}");
                assert_eq!(negotiated(&compat), ProtocolVersionKind::V1);
                assert_eq!(compat.active_wire_version(), ProtocolVersionKind::V1);
            }

            Ok(())
        }

        #[test]
        fn outgoing_v2_agent_notification_fans_out_for_v1_wire() -> Result<(), crate::Error> {
            let compat = ProtocolCompat::new(ProtocolMode::v2_agent());
            let messages = compat.outgoing_notification(UntypedMessage::new(
                "session/update",
                v2::UpdateSessionNotification::new(
                    "sess",
                    v2::SessionUpdate::AgentMessage(v2::AgentMessage::new("msg_agent").content(
                        vec![
                            v2::ContentBlock::Text(v2::TextContent::new("hello")),
                            v2::ContentBlock::Text(v2::TextContent::new("world")),
                        ],
                    )),
                ),
            )?)?;

            assert_eq!(messages.len(), 2);
            let json = messages
                .into_iter()
                .map(|message| {
                    assert_eq!(message.method(), "session/update");
                    Ok(message.params)
                })
                .collect::<Result<Vec<_>, crate::Error>>()?;
            assert_eq!(
                json,
                vec![
                    serde_json::json!({
                        "sessionId": "sess",
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": {
                                "type": "text",
                                "text": "hello"
                            },
                            "messageId": "msg_agent"
                        }
                    }),
                    serde_json::json!({
                        "sessionId": "sess",
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": {
                                "type": "text",
                                "text": "world"
                            },
                            "messageId": "msg_agent"
                        }
                    }),
                ]
            );

            Ok(())
        }

        #[test]
        #[should_panic(expected = "cannot merge ACP builders with different API protocol versions")]
        fn merging_different_api_protocol_modes_panics() {
            let _ = ProtocolMode::v1_agent().merge(ProtocolMode::v2_agent());
        }
    }
}

pub(crate) use imp::{ProtocolCompat, ProtocolMode};
