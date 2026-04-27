#!/usr/bin/env python3
"""
Minimal local server for self-hosted sc.
Serves static files from its own directory and persists data to persist/.
Binds to localhost only — never exposed to the network.

Endpoints:
  GET  /persist/          — list files in persist/
  GET  /persist/<path>    — read a file
  PUT  /persist/<path>    — write a file (creates dirs as needed)
  DELETE /persist/<path>  — delete a file
  GET  /*                 — serve static files (index.html, assets, etc.)
"""

import http.server
import json
import os
import sys

PORT = 21845
PERSIST_DIR = "persist"


def safe_path(requested):
    """Resolve a persist/ path and reject traversal attempts."""
    joined = os.path.normpath(os.path.join(PERSIST_DIR, requested))
    if not joined.startswith(PERSIST_DIR + os.sep) and joined != PERSIST_DIR:
        return None
    return joined


def find_app_html():
    """Return the single .html file in the server directory, or None."""
    htmls = [f for f in os.listdir(".") if f.endswith(".html") and os.path.isfile(f)]
    return htmls[0] if len(htmls) == 1 else None


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/persist/" or self.path == "/persist":
            self._list_persist()
        elif self.path.startswith("/persist/"):
            self._read_persist()
        elif self.path == "/" or self.path.startswith("/?"):
            app = find_app_html()
            if app:
                query = self.path[1:]  # '' or '?...'
                self.send_response(302)
                self.send_header("Location", "/" + app + query)
                self.end_headers()
            else:
                super().do_GET()
        else:
            super().do_GET()

    def do_PUT(self):
        if not self.path.startswith("/persist/"):
            self.send_error(403, "PUT only allowed under /persist/")
            return
        rel = self.path[len("/persist/"):]
        fpath = safe_path(rel)
        if fpath is None:
            self.send_error(403, "Invalid path")
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        os.makedirs(os.path.dirname(fpath), exist_ok=True)
        with open(fpath, "wb") as f:
            f.write(body)

        self.send_response(204)
        self.end_headers()

    def do_DELETE(self):
        if not self.path.startswith("/persist/"):
            self.send_error(403, "DELETE only allowed under /persist/")
            return
        rel = self.path[len("/persist/"):]
        fpath = safe_path(rel)
        if fpath is None:
            self.send_error(403, "Invalid path")
            return

        try:
            os.remove(fpath)
            self.send_response(204)
        except FileNotFoundError:
            self.send_response(204)  # idempotent
        self.end_headers()

    def _list_persist(self):
        files = []
        if os.path.isdir(PERSIST_DIR):
            for root, _dirs, names in os.walk(PERSIST_DIR):
                for name in names:
                    full = os.path.join(root, name)
                    rel = os.path.relpath(full, PERSIST_DIR)
                    files.append(rel.replace(os.sep, "/"))
        body = json.dumps(files).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def _read_persist(self):
        rel = self.path[len("/persist/"):]
        fpath = safe_path(rel)
        if fpath is None:
            self.send_error(403, "Invalid path")
            return

        try:
            with open(fpath, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_error(404, "Not found")

    def end_headers(self):
        # Tag responses so the app can detect self-hosted mode
        self.send_header("X-SC-Self-Hosted", "1")
        super().end_headers()

    def log_message(self, format, *args):
        # Quieter logging — only show persist operations
        if args and "/persist" in str(args[0]):
            super().log_message(format, *args)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(PERSIST_DIR, exist_ok=True)

    server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"sc self-host server running at http://localhost:{PORT}")
    print(f"Data stored in {os.path.abspath(PERSIST_DIR)}/")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(0)
