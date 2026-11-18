"""A PostHog /flags stand-in for a local bench stack: every caller gets the
flags computers need, on. Point POSTHOG_HOST at it (README.md)."""

import argparse
import http.server
import json

FLAGS = ["enable-macro-computers", "enable-agents", "enable-agents-view"]


class Flags(http.server.BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        self.rfile.read(int(self.headers.get("content-length", "0")))
        body = json.dumps(
            {
                "flags": {k: {"key": k, "enabled": True, "variant": None} for k in FLAGS},
                "featureFlags": {k: True for k in FLAGS},
                "errorsWhileComputingFlags": False,
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"bench flags")

    def log_message(self, *args: object) -> None:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=28961)
    args = parser.parse_args()
    http.server.ThreadingHTTPServer(("0.0.0.0", args.port), Flags).serve_forever()


if __name__ == "__main__":
    main()
