"""Small n8n public API client. Never prints keys."""
import json, sys, os, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
from keys import load

K, _ = load()
BASE = "https://keystoneconsultancy.app.n8n.cloud/api/v1"


def api(method, path, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"X-N8N-API-KEY": K["N8N_API_KEY"], "Accept": "application/json", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf8", "replace")
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, txt[:500]


if __name__ == "__main__":
    m, p = sys.argv[1], sys.argv[2]
    b = json.loads(sys.argv[3]) if len(sys.argv) > 3 else None
    s, r = api(m, p, b)
    print(s, json.dumps(r, indent=1)[:4000])
