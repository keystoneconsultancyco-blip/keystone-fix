"""Split the combined N8N_API_KEY value into its three keys. Never prints a value."""
import os, re


def load():
    raw = os.environ.get("N8N_API_KEY", "").strip()
    parts = [p for p in re.split(r"[\s,;]+", raw) if p]
    keys = {}
    for p in parts:
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.+)$", p)
        label, val = (m.group(1), m.group(2)) if m else (None, p)
        val = val.strip().strip('"').strip("'")
        if val.startswith("eyJ"):
            keys["N8N_API_KEY"] = val
        elif val.startswith("sk-ant-"):
            keys["ANTHROPIC_API_KEY"] = val
        elif val.startswith("pat"):
            keys["AIRTABLE_TOKEN"] = val
        else:
            keys[label or "UNKNOWN"] = val
    return keys, [re.match(r"^([A-Za-z_][A-Za-z0-9_]*)", p).group(1) if re.match(r"^[A-Za-z_][A-Za-z0-9_]*\s*[=:]", p) else "(no label)" for p in parts]


if __name__ == "__main__":
    import urllib.request, urllib.error, json
    keys, labels = load()
    print("labels found:", labels)
    print("recognised:", sorted(keys))

    def call(name, url, headers, data=None):
        req = urllib.request.Request(url, headers=headers, data=data)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                print(name, "->", r.status)
        except urllib.error.HTTPError as e:
            print(name, "->", e.code, e.read()[:150].decode("utf8", "replace"))
        except Exception as e:
            print(name, "-> error", type(e).__name__)

    if "N8N_API_KEY" in keys:
        call("n8n", "https://keystoneconsultancy.app.n8n.cloud/api/v1/workflows?limit=1", {"X-N8N-API-KEY": keys["N8N_API_KEY"], "Accept": "application/json"})
    if "AIRTABLE_TOKEN" in keys:
        call("airtable", "https://api.airtable.com/v0/meta/whoami", {"Authorization": "Bearer " + keys["AIRTABLE_TOKEN"]})
    if "ANTHROPIC_API_KEY" in keys:
        call("anthropic", "https://api.anthropic.com/v1/models?limit=1", {"x-api-key": keys["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"})
