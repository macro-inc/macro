{
  agent = {
    region = "us-east-2";
    metrics_collection_interval = 60;
    omit_hostname = true;
    usage_data = false;
    logfile = "";
  };
  metrics = {
    namespace = "Macro/Observability";
    append_dimensions.InstanceId = "\${aws:InstanceId}";
    metrics_collected = {
      disk = {
        measurement = [ "used_percent" ];
        resources = [
          "/"
          "/srv/observability"
        ];
        drop_device = true;
      };
      mem.measurement = [ "used_percent" ];
    };
    force_flush_interval = 60;
  };
}
