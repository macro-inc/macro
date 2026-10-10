{
  loki = {
    auth_enabled = false;
    server = {
      http_listen_address = "127.0.0.1";
      http_listen_port = 3100;
      grpc_listen_address = "127.0.0.1";
      grpc_listen_port = 9095;
    };
    common = {
      instance_addr = "127.0.0.1";
      path_prefix = "/srv/observability/loki";
      replication_factor = 1;
      ring.kvstore.store = "inmemory";
    };
    schema_config.configs = [
      {
        from = "2024-01-01";
        store = "tsdb";
        object_store = "s3";
        schema = "v13";
        index = {
          prefix = "index_";
          period = "24h";
        };
      }
    ];
    storage_config = {
      aws = {
        region = "\${AWS_REGION}";
        bucketnames = "\${LOGS_BUCKET}";
      };
      tsdb_shipper = {
        active_index_directory = "/srv/observability/loki/index";
        cache_location = "/srv/observability/loki/index-cache";
      };
    };
    ingester.wal = {
      enabled = true;
      dir = "/srv/observability/loki/wal";
    };
    compactor = {
      working_directory = "/srv/observability/loki/compactor";
      retention_enabled = true;
      delete_request_store = "s3";
    };
    limits_config = {
      retention_period = "720h";
      allow_structured_metadata = true;
      ingestion_rate_mb = 8;
      ingestion_burst_size_mb = 16;
      max_query_parallelism = 4;
    };
    querier.max_concurrent = 4;
    analytics.reporting_enabled = false;
  };
  tempo = {
    server = {
      http_listen_address = "127.0.0.1";
      http_listen_port = 3200;
      grpc_listen_address = "127.0.0.1";
      grpc_listen_port = 9096;
    };
    memberlist.bind_addr = [ "127.0.0.1" ];
    distributor.receivers.otlp.protocols.grpc.endpoint = "127.0.0.1:4317";
    ingester = {
      max_block_duration = "5m";
      lifecycler.address = "127.0.0.1";
    };
    compactor.compaction.block_retention = "168h";
    storage.trace = {
      backend = "s3";
      wal.path = "/srv/observability/tempo/wal";
      s3 = {
        bucket = "\${TRACES_BUCKET}";
        region = "\${AWS_REGION}";
        endpoint = "s3.\${AWS_REGION}.amazonaws.com";
      };
    };
    usage_report.reporting_enabled = false;
  };
  prometheus = {
    global.scrape_interval = "30s";
    scrape_configs = [
      {
        job_name = "observability";
        static_configs = [
          {
            targets = [
              "127.0.0.1:9090"
              "127.0.0.1:3100"
              "127.0.0.1:3200"
              "127.0.0.1:12345"
            ];
          }
        ];
      }
    ];
  };
}
