#!/usr/bin/env python3
import json
import sys
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

packages_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else None
if packages_dir is None:
    print("usage: local-bun-registry.py <bunDeps/share/bun-packages>", file=sys.stderr)
    sys.exit(64)

packages = {}


def add_package(directory: Path):
    package_json_path = directory / "package.json"
    if not package_json_path.exists():
        return
    package_json = json.loads(package_json_path.read_text())
    name = package_json.get("name")
    version = package_json.get("version")
    if not name or not version:
        return

    metadata = packages.setdefault(name, {"_id": name, "name": name, "dist-tags": {"latest": version}, "versions": {}})
    tarball_name = f"{name.split('/', 1)[1] if name.startswith('@') else name}-{version}.tgz"
    version_metadata = dict(package_json)
    version_metadata["dist"] = {
        **package_json.get("dist", {}),
        "tarball": f"https://registry.npmjs.org/{name}/-/{tarball_name}",
    }
    metadata["versions"][version] = version_metadata
    if version > metadata["dist-tags"]["latest"]:
        metadata["dist-tags"]["latest"] = version


for entry in packages_dir.iterdir():
    if not entry.is_dir():
        continue
    if entry.name.startswith("@"):
        for scoped_entry in entry.iterdir():
            if scoped_entry.is_dir():
                add_package(scoped_entry)
    else:
        add_package(entry)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        package_name = unquote(urlparse(self.path).path.lstrip("/"))
        metadata = packages.get(package_name)
        if metadata is None:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(f"missing package metadata: {package_name}\n".encode())
            return
        body = json.dumps(metadata).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
print(server.server_address[1], flush=True)
server.serve_forever()
