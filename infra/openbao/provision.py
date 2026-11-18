#!/usr/bin/env python3
"""Provision one Passwords team in the hosted dev OpenBao.

Talks only to the exact origin below, with TLS verified against its hostname.
Operators reach it through the SSM tunnel in the openbao stack README
("Operator tunnel") and pass
the tunnel's local port with --connect; the TCP endpoint changes, the TLS
identity does not.
"""

import argparse
import http.client
import ipaddress
import os
from pathlib import Path
import socket
import ssl
import sys
from urllib.request import HTTPSHandler, ProxyHandler, build_opener
from uuid import UUID

from openbao_provisioning import NoRedirect, OpenBaoClient, provision_team

HOSTNAME = "openbao-dev.macro-internal.com"
ORIGIN = f"https://{HOSTNAME}"


def parse_connect(value):
    """A loopback `host:port` for the operator tunnel; anything else is refused."""
    host, separator, port = value.rpartition(":")
    host = host.strip("[]")
    if not separator or not port.isdigit() or not 0 < int(port) < 65536:
        raise argparse.ArgumentTypeError("--connect must be a loopback host:port")
    try:
        loopback = host == "localhost" or ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = False
    if not loopback:
        raise argparse.ArgumentTypeError("--connect must be a loopback host:port")
    return host, int(port)


class TunnelHTTPSHandler(HTTPSHandler):
    """HTTPS to HOSTNAME, optionally over a loopback TCP endpoint; TLS always checks HOSTNAME."""
    def __init__(self, context, connect=None):
        super().__init__(context=context)
        self.connect = connect

    def https_open(self, request):
        if request.host != HOSTNAME:
            raise ValueError("hosted provisioning talks only to " + ORIGIN)
        tls, connect = self._context, self.connect

        class Connection(http.client.HTTPSConnection):
            def connect(self):
                endpoint = connect or (self.host, self.port or 443)
                sock = socket.create_connection(endpoint, self.timeout)
                self.sock = tls.wrap_socket(sock, server_hostname=HOSTNAME)

        return self.do_open(Connection, request, context=tls)


class HostedOpenBao(OpenBaoClient):
    def __init__(self, token, connect=None, context=None):
        tls = context or ssl.create_default_context()
        if tls.verify_mode != ssl.CERT_REQUIRED or not tls.check_hostname:
            raise ValueError("hosted provisioning requires verified TLS")
        opener = build_opener(ProxyHandler({}), NoRedirect(), TunnelHTTPSHandler(tls, connect))
        super().__init__(ORIGIN, token, opener)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--team-id", required=True, type=UUID)
    parser.add_argument("--jwt-public-key", required=True, type=Path)
    parser.add_argument("--jwt-issuer", required=True)
    parser.add_argument("--connect", type=parse_connect, help="loopback host:port of the operator tunnel")
    arguments = parser.parse_args()
    token = os.environ.get("BAO_TOKEN")
    if not token:
        parser.error("BAO_TOKEN is required (read it from Doppler openbao/dev; never pass it as an argument)")
    namespace = provision_team(
        HostedOpenBao(token, arguments.connect),
        arguments.team_id,
        arguments.jwt_public_key.read_text(),
        arguments.jwt_issuer,
    )
    print(f"Provisioned hosted Passwords namespace {namespace}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
