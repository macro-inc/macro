# The egress test's peers (files/teammate-egress-test), run with the image's
# Python in test containers and on the host, never in a teammate:
#   listen <port>              TCP: answers "ok"; UDP: logs each datagram's
#                              sender; ICMP needs nothing (the kernel answers)
#   redirect <port> <url>      HTTP: 302 to <url>
#   proxy <port>               HTTP CONNECT proxy
#   dns <port> <ipv4>          DNS: an A record of <ipv4> for names under
#                              .test; anything else is forwarded to 8.8.8.8
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def log(line):
    print(line, flush=True)


def listen(port):
    def tcp(family, address):
        server = socket.socket(family, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if family == socket.AF_INET6:
            server.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        server.bind((address, port))
        server.listen(64)
        while True:
            connection, peer = server.accept()
            log(f"tcp from {peer[0]}")
            connection.sendall(b"ok\n")
            connection.close()

    def udp(family, address):
        server = socket.socket(family, socket.SOCK_DGRAM)
        if family == socket.AF_INET6:
            server.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        server.bind((address, port))
        while True:
            data, peer = server.recvfrom(2048)
            log(f"udp from {peer[0]} {data.decode(errors='replace').strip()}")

    threads = [
        threading.Thread(target=tcp, args=(socket.AF_INET, "0.0.0.0")),
        threading.Thread(target=udp, args=(socket.AF_INET, "0.0.0.0")),
    ]
    if socket.has_ipv6:
        threads += [
            threading.Thread(target=tcp, args=(socket.AF_INET6, "::")),
            threading.Thread(target=udp, args=(socket.AF_INET6, "::")),
        ]
    for thread in threads:
        thread.daemon = True
        thread.start()
    log(f"listening on {port}")
    threading.Event().wait()


def redirect(port, url):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", url)
            self.send_header("Content-Length", "0")
            self.end_headers()

    log(f"redirecting on {port} to {url}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


def proxy(port):
    class Handler(BaseHTTPRequestHandler):
        def do_CONNECT(self):
            host, _, target = self.path.rpartition(":")
            try:
                upstream = socket.create_connection((host.strip("[]"), int(target)), timeout=5)
            except OSError:
                self.send_error(502)
                return
            self.send_response(200)
            self.end_headers()
            for source, sink in ((self.connection, upstream), (upstream, self.connection)):
                threading.Thread(target=pipe, args=(source, sink), daemon=True).start()
            threading.Event().wait(10)

    def pipe(source, sink):
        try:
            while data := source.recv(4096):
                sink.sendall(data)
        except OSError:
            pass

    log(f"proxying on {port}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


def dns(port, answer):
    server = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    server.bind(("0.0.0.0", port))
    log(f"answering {answer} on {port}")
    address = socket.inet_aton(answer)
    while True:
        query, peer = server.recvfrom(512)
        log(f"dns from {peer[0]}")
        # The header with the query's id, one question (echoed), one answer.
        end = 12
        while query[end] != 0:
            end += query[end] + 1
        question = query[12 : end + 5]
        name = query[12:end].lower()
        if not name.endswith(b"\x04test"):
            upstream = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            upstream.settimeout(3)
            try:
                upstream.sendto(query, ("8.8.8.8", 53))
                server.sendto(upstream.recvfrom(4096)[0], peer)
            except OSError:
                pass
            finally:
                upstream.close()
            continue
        # An A record for an A question; no answer for anything else (AAAA).
        if question[-4:-2] == b"\x00\x01":
            header = query[:2] + b"\x81\x80\x00\x01\x00\x01\x00\x00\x00\x00"
            record = b"\xc0\x0c\x00\x01\x00\x01\x00\x00\x00\x3c\x00\x04" + address
        else:
            header = query[:2] + b"\x81\x80\x00\x01\x00\x00\x00\x00\x00\x00"
            record = b""
        server.sendto(header + question + record, peer)


modes = {"listen": listen, "redirect": redirect, "proxy": proxy, "dns": dns}
mode, port, *rest = sys.argv[1:]
modes[mode](int(port), *rest)
