macro_rules! table {
    (
        $(
            $(#[$attr:meta])*
            $v:vis struct $name:ident {
                local: $local:literal,
            }
        )*
    ) => {
        $(
            $(#[$attr])*
            $v struct $name;

            impl $name {
                $v const LOCAL: &'static str = $local;
            }
        )*
    };
}

table! {
    /// Table for bulk-upload request tracking.
    pub struct BulkUploadRequestsTable {
        local: "bulk-upload",
    }

    /// Table for connection-gateway websocket state.
    pub struct ConnectionGatewayTable {
        local: "connection-gateway-table",
    }

    /// Table for static-file-service metadata.
    pub struct StaticFileMetadataTable {
        local: "static-file-metadata",
    }
}
