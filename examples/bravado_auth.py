"""HMAC authentication for server-side requests examples (requires requests)."""
import hashlib
import hmac
import os
import time
from urllib.parse import parse_qsl, quote, unquote, urlsplit

import requests


def canonical_path(url):
    parts = urlsplit(url)
    path = unquote(parts.path or "/")
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    query = parse_qsl(parts.query, keep_blank_values=True)
    if len({k for k, _ in query}) != len(query):
        raise ValueError("Use each query parameter once")
    encoded = "&".join(quote(k, safe="-_.~") + "=" + quote(v, safe="-_.~")
                       for k, v in sorted(query))
    return path + ("?" + encoded if encoded else "")


class BravadoAuth(requests.auth.AuthBase):
    def __init__(self, key=None, secret=None):
        self.key = key if key is not None else os.environ["BRAVADO_API_KEY"]
        self.secret = secret if secret is not None else os.environ["BRAVADO_API_SECRET"]

    def __call__(self, request):
        if urlsplit(request.url).netloc != "partner-api.bravadotrade.com" or not request.url.startswith("https://"):
            raise ValueError("Send Bravado credentials only to the HTTPS Partner API")
        body = request.body or b""
        if isinstance(body, str):
            body = body.encode("utf-8")
            request.body = body
            request.headers["Content-Length"] = str(len(body))
        if not isinstance(body, bytes):
            raise ValueError("Serialize the request body before signing")
        timestamp = str(time.time_ns() // 1_000_000)
        payload = "\n".join([timestamp, request.method.upper(), canonical_path(request.url),
                              hashlib.sha256(body).hexdigest()])
        request.headers.pop("Authorization", None)
        request.headers.update({
            "X-BRAVADO-API-KEY": self.key,
            "X-BRAVADO-TIMESTAMP": timestamp,
            "X-BRAVADO-SIGNATURE": hmac.new(self.secret.encode(), payload.encode(), hashlib.sha256).hexdigest(),
        })
        return request


class BravadoSession(requests.Session):
    def request(self, *args, **kwargs):
        # A redirect changes the signed path and must be handled explicitly.
        kwargs["allow_redirects"] = False
        kwargs.setdefault("timeout", 15)
        if "auth" not in kwargs:
            kwargs["auth"] = BravadoAuth()
        return super().request(*args, **kwargs)


session = BravadoSession()
