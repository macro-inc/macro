# The last chart line for Tempo 2.x (2.10.7). Tempo 3 drops the ingesters for
# a Kafka-based write path; this cluster keeps the classic one.
{
  repo = "https://grafana-community.github.io/helm-charts";
  chart = "tempo-distributed";
  version = "2.26.2";
  chartHash = "sha256-z9QaEbdcDZCTZKjWbFd66zsvjxqMuR1BPSwh1B53TpI=";
}
