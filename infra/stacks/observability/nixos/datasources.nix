{
  apiVersion = 1;
  datasources = [
    {
      name = "Prometheus";
      uid = "prometheus";
      type = "prometheus";
      access = "proxy";
      url = "http://127.0.0.1:8081/prometheus";
      editable = false;
      isDefault = true;
    }
    {
      name = "Loki";
      uid = "loki";
      type = "loki";
      access = "proxy";
      url = "http://127.0.0.1:8081/loki";
      editable = false;
    }
    {
      name = "Tempo";
      uid = "tempo";
      type = "tempo";
      access = "proxy";
      url = "http://127.0.0.1:8081/tempo";
      editable = false;
    }
  ];
}
