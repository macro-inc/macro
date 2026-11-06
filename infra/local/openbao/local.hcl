# Development only. The dev server supplies its in-memory storage and listener.
default_max_request_duration = "90s"

audit "file" "passwords" {
  options {
    file_path = "stdout"
    log_raw = "false"
  }
}
