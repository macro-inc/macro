"""Send the collected CI telemetry to the OTLP logs route. Best effort, never fails the job."""

import gzip
import os
import sys
import time
import urllib.parse
import urllib.request

ATTEMPTS = 2
TIMEOUT_SECONDS = 10
RETRY_DELAY_SECONDS = 2


def authorization(headers):
    """Read the `Authorization=Bearer%20...` form the credential step writes."""
    name, _, value = headers.partition("=")
    return name, urllib.parse.unquote(value)


def send(url, body, header):
    request = urllib.request.Request(
        url,
        data=gzip.compress(body),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
            header[0]: header[1],
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.status


def main():
    started = time.monotonic()
    path = os.environ["CI_TELEMETRY_EVENTS"]
    if not os.path.exists(path):
        print("Nothing to send")
        return
    with open(path, "rb") as handle:
        body = handle.read()
    header = authorization(os.environ["OTLP_HEADERS"])
    for attempt in range(1, ATTEMPTS + 1):
        try:
            status = send(os.environ["OTLP_LOGS_URL"], body, header)
            print(f"Sent {len(body)} bytes, HTTP {status}, {time.monotonic() - started:.1f} s")
            return
        except Exception as error:
            print(f"::warning::CI telemetry send attempt {attempt} failed: {type(error).__name__}")
            if attempt < ATTEMPTS:
                time.sleep(RETRY_DELAY_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"::warning::CI telemetry not sent: {type(error).__name__}")
    sys.exit(0)
