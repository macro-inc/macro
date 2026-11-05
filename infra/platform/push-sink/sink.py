#!/usr/bin/env python3
"""Stands in for SNS mobile push on an instance, as Mailpit does for email.

Answers the SNS calls Macro makes (crates/sns_client), remembers endpoints in memory, and
sends nothing. Each publish logs its target and size, never its content.
"""

import http.server
import json
import sys
import urllib.parse
import uuid
from xml.sax.saxutils import escape

XMLNS = "http://sns.amazonaws.com/doc/2010-03-31/"
ACCOUNT_ID = "000000000000"
REGION = "us-east-1"
ENDPOINT_ENABLED = "true"


class Sink:
    def __init__(self):
        self.endpoints = {}
        self.published = 0

    def handle(self, form):
        """The response XML for one SNS request; a (status, body) pair."""
        action = form.get("Action", "")
        handler = getattr(self, f"_{action}", None)
        if handler is None:
            return 400, error("InvalidAction", f"{action} is not supported")
        return handler(form)

    def _CreatePlatformEndpoint(self, form):
        application = form.get("PlatformApplicationArn", "").rsplit("/", 1)[-1]
        token = form.get("Token", "")
        # SNS returns the same endpoint for a token it already knows.
        for arn, attributes in self.endpoints.items():
            if attributes["Token"] == token:
                return 200, result("CreatePlatformEndpoint", tag("EndpointArn", arn))
        arn = f"arn:aws:sns:{REGION}:{ACCOUNT_ID}:endpoint/{application}/{uuid.uuid4()}"
        self.endpoints[arn] = {"Token": token, "Enabled": ENDPOINT_ENABLED}
        return 200, result("CreatePlatformEndpoint", tag("EndpointArn", arn))

    def _GetEndpointAttributes(self, form):
        attributes = self.endpoints.get(form.get("EndpointArn", ""))
        if attributes is None:
            return 404, error("NotFound", "no such endpoint")
        entries = "".join(
            f"<entry>{tag('key', key)}{tag('value', value)}</entry>"
            for key, value in attributes.items()
        )
        return 200, result("GetEndpointAttributes", f"<Attributes>{entries}</Attributes>")

    def _SetEndpointAttributes(self, form):
        attributes = self.endpoints.get(form.get("EndpointArn", ""))
        if attributes is None:
            return 404, error("NotFound", "no such endpoint")
        attributes.update(parse_attributes(form))
        return 200, empty("SetEndpointAttributes")

    def _DeleteEndpoint(self, form):
        self.endpoints.pop(form.get("EndpointArn", ""), None)
        return 200, empty("DeleteEndpoint")

    def _Publish(self, form):
        self.published += 1
        target = form.get("TargetArn") or form.get("TopicArn") or ""
        log(action="publish", target=target, bytes=len(form.get("Message", "")))
        return 200, result("Publish", tag("MessageId", str(uuid.uuid4())))


def parse_attributes(form):
    """SNS's `Attributes.entry.N.key` and `.value` form fields as a dict."""
    attributes = {}
    index = 1
    while f"Attributes.entry.{index}.key" in form:
        attributes[form[f"Attributes.entry.{index}.key"]] = form.get(
            f"Attributes.entry.{index}.value", ""
        )
        index += 1
    return attributes


def tag(name, value):
    return f"<{name}>{escape(value)}</{name}>"


def request_id():
    return f"<ResponseMetadata>{tag('RequestId', str(uuid.uuid4()))}</ResponseMetadata>"


def result(action, body):
    return (
        f'<{action}Response xmlns="{XMLNS}"><{action}Result>{body}</{action}Result>'
        f"{request_id()}</{action}Response>"
    )


def empty(action):
    return f'<{action}Response xmlns="{XMLNS}">{request_id()}</{action}Response>'


def error(code, message):
    return (
        f'<ErrorResponse xmlns="{XMLNS}"><Error><Type>Sender</Type>{tag("Code", code)}'
        f'{tag("Message", message)}</Error>{request_id()}</ErrorResponse>'
    )


def log(**fields):
    print(json.dumps(fields), file=sys.stderr, flush=True)


SINK = Sink()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        form = dict(urllib.parse.parse_qsl(body, keep_blank_values=True))
        status, response = SINK.handle(form)
        payload = response.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/xml")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
