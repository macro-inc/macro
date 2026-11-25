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
    pattern_ingester.enabled = true;
    compactor = {
      working_directory = "/srv/observability/loki/compactor";
      retention_enabled = true;
      delete_request_store = "s3";
    };
    limits_config = {
      retention_period = "720h";
      allow_structured_metadata = true;
      volume_enabled = true;
      discover_log_levels = true;
      # Every sender together, counting structured metadata.
      ingestion_rate_mb = 24;
      ingestion_burst_size_mb = 48;
      # Our services' logs from one environment are one stream (they send no
      # instance label), so this keeps one from using the whole rate. Sharding
      # would split a busy stream and multiply it.
      per_stream_rate_limit = "6MB";
      per_stream_rate_limit_burst = "24MB";
      shard_streams.enabled = false;
      max_query_parallelism = 4;
      # The CI dashboard groups PR steps by workflow, job and step: about 600 a day.
      max_query_series = 2000;
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
    metrics_generator = {
      ring.instance_addr = "127.0.0.1";
      processor = {
        local_blocks = {
          filter_server_spans = false;
          flush_to_storage = true;
          max_live_traces = 10000;
          max_block_bytes = 50000000;
          concurrent_blocks = 2;
        };
      };
      traces_storage.path = "/srv/observability/tempo/generator/traces";
      storage.path = "/srv/observability/tempo/generator/wal";
      # The sampler holds a trace 30s before sending it, and the generator drops
      # spans that ended longer ago than this (30s by default).
      metrics_ingestion_time_range_slack = "5m";
    };
    overrides.defaults.metrics_generator = {
      # Span metrics and service graphs come from the sampler, which sees the
      # spans sampling drops.
      processors = [ "local-blocks" ];
    };
    # Each distributor's. The sampler's budgets hold each service down; this
    # holds their sum, at a few times what prod is expected to store.
    overrides.defaults.ingestion = {
      rate_strategy = "local";
      rate_limit_bytes = 30000000;
      burst_size_bytes = 40000000;
      # Live traces of one ingester, and of one metrics generator's local
      # blocks; dev alone peaked at 4k.
      max_traces_per_user = 30000;
    };
    query_frontend.metrics.concurrent_jobs = 4;
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
