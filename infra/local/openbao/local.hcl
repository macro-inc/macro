# Local development only. Never use this colocated seal for hosted environments.
default_max_request_duration = "90s"
api_addr = "http://openbao:8200"
cluster_addr = "https://127.0.0.1:8201"

listener "tcp" {
  address = "0.0.0.0:8200"
  tls_disable = true
}

storage "raft" {
  path = "/openbao/file/data"
  node_id = "macro-local"
}

seal "static" {
  current_key_id = "macro-local-v1"
  current_key = "file:///openbao/file/seal.key"
}

audit "file" "passwords" {
  options {
    file_path = "stdout"
    log_raw = "false"
  }
}
