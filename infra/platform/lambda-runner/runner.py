#!/usr/bin/env python3
"""Run an unmodified AWS Lambda binary as a long-running pod.

A `lambda_runtime` binary only needs the Lambda Runtime API. This serves that
API on loopback, feeds it events from the handler's trigger, and acknowledges
them from its responses, so handlers run on any cluster with no code change.

LAMBDA_TRIGGER selects the event source:
  schedule:<seconds>  an EventBridge scheduled event on an interval, or LAMBDA_SCHEDULE_INPUT
                      (JSON) in its place, as a rule's target `input` replaces the event
  sqs:<queue>         SQS batches; deleted once handled (partial failures honored)
  s3:<queue>          S3 events a bucket webhook enqueued; each body is the event
"""

import http.server
import json
import os
import queue
import subprocess
import sys
import threading
import time
import urllib.request
import uuid

API_PREFIX = "/2018-06-01/runtime"
RUNTIME_ADDRESS = ("127.0.0.1", 9001)
SQS_ENDPOINT = os.environ.get("LAMBDA_SQS_ENDPOINT", "http://queue-gateway:9324")
ACCOUNT_ID = "000000000000"
REGION = "us-east-1"
# Every handler's stack maps one message to an invocation, and some reject more.
BATCH_SIZE = 1
LONG_POLL_SECONDS = 20
DEADLINE_SECONDS = 900
# A message stays hidden past its handler's deadline, as a Lambda queue's timeout must.
VISIBILITY_SECONDS = DEADLINE_SECONDS + 30


def scheduled_event(now=None):
    """The event EventBridge delivers for a schedule rule."""
    return {
        "version": "0",
        "id": str(uuid.uuid4()),
        "detail-type": "Scheduled Event",
        "source": "aws.events",
        "account": ACCOUNT_ID,
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "region": REGION,
        "resources": [],
        "detail": {},
    }


def sqs_event(messages, queue_name):
    """The event Lambda's SQS mapping delivers for a batch."""
    return {
        "Records": [
            {
                "messageId": m["MessageId"],
                "receiptHandle": m["ReceiptHandle"],
                "body": m["Body"],
                "attributes": m.get("Attributes", {}),
                "messageAttributes": m.get("MessageAttributes", {}),
                "md5OfBody": m.get("MD5OfBody", ""),
                "eventSource": "aws:sqs",
                "eventSourceARN": f"arn:aws:sqs:{REGION}:{ACCOUNT_ID}:{queue_name}",
                "awsRegion": REGION,
            }
            for m in messages
        ]
    }


def handled_messages(messages, result):
    """The messages to delete: all, minus any `batchItemFailures` reported."""
    failed = set()
    if isinstance(result, dict):
        for item in result.get("batchItemFailures") or []:
            failed.add(item.get("itemIdentifier"))
    return [m for m in messages if m["MessageId"] not in failed]


def sqs_call(action, body):
    request = urllib.request.Request(
        SQS_ENDPOINT,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/x-amz-json-1.0",
            "X-Amz-Target": f"AmazonSQS.{action}",
        },
    )
    with urllib.request.urlopen(request, timeout=LONG_POLL_SECONDS + 10) as response:
        return json.loads(response.read() or b"{}")


class Invocations:
    """One invocation at a time, as a Lambda execution environment runs them."""

    def __init__(self):
        self.pending = queue.Queue(maxsize=1)
        self.results = {}
        self.done = {}

    def invoke(self, payload):
        """Hand `payload` to the handler and wait. Returns (ok, result)."""
        request_id = str(uuid.uuid4())
        finished = threading.Event()
        self.done[request_id] = finished
        self.pending.put((request_id, payload))
        finished.wait()
        del self.done[request_id]
        return self.results.pop(request_id)

    def finish(self, request_id, ok, result):
        self.results[request_id] = (ok, result)
        self.done[request_id].set()


def runtime_handler(invocations):
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self):
            if self.path != f"{API_PREFIX}/invocation/next":
                return self.reply(404)
            request_id, payload = invocations.pending.get()
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Lambda-Runtime-Aws-Request-Id", request_id)
            self.send_header(
                "Lambda-Runtime-Deadline-Ms",
                str(int((time.time() + DEADLINE_SECONDS) * 1000)),
            )
            self.send_header(
                "Lambda-Runtime-Invoked-Function-Arn",
                f"arn:aws:lambda:{REGION}:{ACCOUNT_ID}:function:"
                + os.environ.get("AWS_LAMBDA_FUNCTION_NAME", "handler"),
            )
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            parts = self.path[len(API_PREFIX) + 1 :].split("/")
            if parts[:1] == ["init"]:
                print(f"handler failed to initialize: {body.decode()}", file=sys.stderr)
                self.reply(202)
                os._exit(1)
            if len(parts) != 3 or parts[0] != "invocation":
                return self.reply(404)
            ok = parts[2] == "response"
            if not ok:
                print(f"invocation failed: {body.decode()}", file=sys.stderr)
            try:
                result = json.loads(body) if body else None
            except ValueError:
                result = None
            invocations.finish(parts[1], ok, result)
            self.reply(202)

        def reply(self, status):
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *args):
            pass

    return Handler


def schedule_payload(fixed_input):
    """What one schedule tick delivers: the rule's fixed input, or else its event."""
    return json.loads(fixed_input) if fixed_input else scheduled_event()


def run_schedule(invocations, seconds):
    fixed_input = os.environ.get("LAMBDA_SCHEDULE_INPUT")
    while True:
        invocations.invoke(schedule_payload(fixed_input))
        time.sleep(seconds)


def run_queue(invocations, queue_name, unwrap_s3):
    queue_url = f"{SQS_ENDPOINT}/{ACCOUNT_ID}/{queue_name}"
    created = False
    while True:
        try:
            # The handler owns its event source, as an event mapping does.
            if not created:
                sqs_call("CreateQueue", {"QueueName": queue_name})
                created = True
            received = sqs_call(
                "ReceiveMessage",
                {
                    "QueueUrl": queue_url,
                    "MaxNumberOfMessages": BATCH_SIZE,
                    "WaitTimeSeconds": LONG_POLL_SECONDS,
                    "VisibilityTimeout": VISIBILITY_SECONDS,
                },
            )
            messages = received.get("Messages") or []
            if not messages:
                continue
            if unwrap_s3:
                payload = json.loads(messages[0]["Body"])
            else:
                payload = sqs_event(messages, queue_name)
            ok, result = invocations.invoke(payload)
            if not ok:
                continue  # Redelivered after the visibility timeout, like Lambda.
            for message in handled_messages(messages, result):
                sqs_call(
                    "DeleteMessage",
                    {"QueueUrl": queue_url, "ReceiptHandle": message["ReceiptHandle"]},
                )
        # This thread is the worker: a bad message or a failed call must not end it.
        except (OSError, ValueError) as error:
            print(f"handling {queue_name}: {error}", file=sys.stderr)
            time.sleep(5)


def main():
    trigger = os.environ["LAMBDA_TRIGGER"]
    kind, _, argument = trigger.partition(":")
    invocations = Invocations()
    server = http.server.ThreadingHTTPServer(RUNTIME_ADDRESS, runtime_handler(invocations))
    threading.Thread(target=server.serve_forever, daemon=True).start()

    environment = dict(os.environ)
    environment["AWS_LAMBDA_RUNTIME_API"] = f"{RUNTIME_ADDRESS[0]}:{RUNTIME_ADDRESS[1]}"
    environment.setdefault("AWS_LAMBDA_FUNCTION_NAME", os.path.basename(sys.argv[1]))
    environment.setdefault("AWS_LAMBDA_FUNCTION_MEMORY_SIZE", "512")
    environment.setdefault("AWS_LAMBDA_FUNCTION_VERSION", "$LATEST")
    handler = subprocess.Popen(sys.argv[1:], env=environment)

    if kind == "schedule":
        target, args = run_schedule, (invocations, int(argument))
    elif kind in ("sqs", "s3"):
        target, args = run_queue, (invocations, argument, kind == "s3")
    else:
        sys.exit(f"unknown LAMBDA_TRIGGER {trigger!r}")
    threading.Thread(target=target, args=args, daemon=True).start()
    sys.exit(handler.wait())


if __name__ == "__main__":
    main()
