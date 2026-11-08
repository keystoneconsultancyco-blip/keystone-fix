"""Safely patch an EXISTING [Stock] workflow in n8n.
1. Downloads the live version and saves a backup in n8n/backups/patches/.
2. Applies a modification function to it (adds/changes nodes; never deletes the workflow).
3. PUTs it back with only the fields n8n accepts, then re-checks it is still active.
Never prints keys."""
import json, os, sys, datetime, copy
sys.path.insert(0, os.path.dirname(__file__))
from n8napi import api

BACKUP_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'n8n', 'backups', 'patches')
ALERT_WF = 'GKF6X82UvFFth43w'
ALLOWED_SETTINGS = {'executionOrder', 'timezone', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveExecutionProgress', 'executionTimeout', 'errorWorkflow', 'callerPolicy'}


def get(wid):
    s, w = api('GET', f'/workflows/{wid}')
    if s != 200: raise SystemExit(f'GET {wid} failed {s}: {str(w)[:200]}')
    return w


def patch(wid, modify, label):
    live = get(wid)
    if not live['name'].startswith('[Stock]'):
        raise SystemExit('stock_patch only handles [Stock] workflows')
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    fn = os.path.join(BACKUP_DIR, f'{stamp}__{wid}__before-{label}.json')
    json.dump(live, open(fn, 'w'), indent=2)
    was_active = live['active']
    new = copy.deepcopy(live)
    modify(new)
    settings = {k: v for k, v in (new.get('settings') or {}).items() if k in ALLOWED_SETTINGS}
    body = {'name': new['name'], 'nodes': new['nodes'], 'connections': new['connections'], 'settings': settings}
    s, r = api('PUT', f'/workflows/{wid}', body)
    if s != 200: raise SystemExit(f'PUT failed {s}: {json.dumps(r)[:500]}')
    after = get(wid)
    if was_active and not after['active']:
        s2, r2 = api('POST', f'/workflows/{wid}/activate')
        after = get(wid)
        if not after['active']: raise SystemExit(f'Re-activation failed {s2}: {json.dumps(r2)[:400]}')
    return {'name': after['name'], 'active': after['active'], 'errorWorkflow': (after.get('settings') or {}).get('errorWorkflow'), 'nodes': len(after['nodes']), 'backup': os.path.basename(fn)}


def restore(backup_file):
    live = json.load(open(backup_file))
    body = {'name': live['name'], 'nodes': live['nodes'], 'connections': live['connections'], 'settings': {k: v for k, v in (live.get('settings') or {}).items() if k in ALLOWED_SETTINGS}}
    return api('PUT', f"/workflows/{live['id']}", body)[0]


def node(w, name):
    for n in w['nodes']:
        if n['name'] == name: return n
    raise KeyError(name)


def connect(w, frm, to, out=0, inp=0):
    c = w['connections'].setdefault(frm, {'main': []})
    while len(c['main']) <= out: c['main'].append([])
    if not any(x['node'] == to for x in c['main'][out]): c['main'][out].append({'node': to, 'type': 'main', 'index': inp})


def disconnect(w, frm, to):
    for outs in w['connections'].get(frm, {}).get('main', []):
        outs[:] = [x for x in outs if x['node'] != to]


def rewire_targets(w, frm, out_idx, new_targets):
    c = w['connections'].setdefault(frm, {'main': []})
    while len(c['main']) <= out_idx: c['main'].append([])
    c['main'][out_idx] = [{'node': t, 'type': 'main', 'index': 0} for t in new_targets]
