'use strict';
// Minimal local n8n executor for tests. It runs the GENERATED workflow JSON (the same
// file you import into n8n): Code nodes run their real jsCode in a sandbox, and
// HTTP/Twilio nodes call mock handlers. It supports the node types our generator
// uses, n8n expressions ({{ }}), IF/Switch routing and paired-item lineage ($('Node').item).

const vm = require('vm');

function makeDollar(state, lineage) {
  return (name) => {
    const out = state.outputs[name];
    if (!out) throw new Error(`Referenced node "${name}" has not run`);
    return {
      all: () => out.map((i) => ({ json: i.json })),
      first: () => ({ json: out[0] && out[0].json }),
      get item() {
        if (!lineage || lineage[name] === undefined) throw new Error(`No paired item from "${name}"`);
        return { json: lineage[name] };
      },
    };
  };
}

function evalExpr(value, ctx) {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  const s = value.slice(1);
  const single = s.match(/^\{\{([\s\S]*)\}\}$/);
  const run = (expr) => vm.runInNewContext(`(${expr})`, { ...ctx, JSON, Math, Date, String, Number, encodeURIComponent });
  if (single) return run(single[1]);
  return s.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => String(run(e)));
}

function runCode(node, items, state, wfName) {
  const { mode, jsCode } = node.parameters;
  const base = {
    console, require, Buffer, URL, URLSearchParams, setTimeout,
    $execution: { id: 'sim-' + state.execId, mode: 'test', customData: { set: (k, v) => { state.customData[k] = v; }, get: (k) => state.customData[k] } },
    $workflow: { name: wfName, id: 'sim-wf' },
    $getWorkflowStaticData: () => state.staticData,
    $now: { toJSDate: () => state.now, toISO: () => state.now.toISOString() },
  };
  const wrap = (src) => `(async () => {\n${src}\n})()`;
  if (mode === 'runOnceForEachItem') {
    return Promise.all(items.map(async (it, i) => {
      const ctx = { ...base, $json: it.json, $input: { item: { json: it.json }, all: () => items.map((x) => ({ json: x.json })) }, $: makeDollar(state, it.lin), $itemIndex: i };
      const res = await vm.runInNewContext(wrap(jsCode), ctx, { filename: node.name });
      if (res === undefined || res === null) return [];
      const r = Array.isArray(res) ? res : [res];
      return r.map((x) => ({ json: x.json !== undefined ? x.json : x, lin: { ...it.lin } }));
    })).then((arrs) => arrs.flat());
  }
  const ctx = { ...base, $input: { all: () => items.map((x) => ({ json: x.json })), first: () => ({ json: items[0] && items[0].json }) }, $json: items[0] && items[0].json, $: makeDollar(state, items[0] && items[0].lin) };
  return Promise.resolve(vm.runInNewContext(wrap(jsCode), ctx, { filename: node.name })).then((res) => {
    const r = (res || []).map((x) => (x && x.json !== undefined ? x : { json: x }));
    return r.map((x, i) => {
      const src = typeof x.pairedItem === 'number' ? items[x.pairedItem] : x.pairedItem && typeof x.pairedItem.item === 'number' ? items[x.pairedItem.item] : r.length === items.length ? items[i] : items[0];
      return { json: x.json, lin: { ...(src ? src.lin : {}) } };
    });
  });
}

async function simulate(wf, { start, items = [{}], mocks = {}, staticData = {}, now = new Date(), maxSteps = 500 } = {}) {
  const nodes = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const state = { outputs: {}, staticData, customData: {}, now, execId: Math.floor(Math.random() * 1e6) };
  const result = { responses: [], calls: [], ran: [], errors: [], state };
  const queue = [{ node: start, items: items.map((j) => ({ json: j, lin: {} })) }];
  let steps = 0;
  while (queue.length) {
    if (++steps > maxSteps) throw new Error('simulate: too many steps (loop?)');
    const { node: name, items: input } = queue.shift();
    const node = nodes[name];
    if (!node) throw new Error(`Unknown node ${name}`);
    if (!input.length) continue;
    result.ran.push(name);
    let outputs = [[]];
    const t = node.type.replace('n8n-nodes-base.', '');
    try {
      if (['webhook', 'scheduleTrigger', 'manualTrigger', 'errorTrigger', 'noOp'].includes(t)) outputs = [input];
      else if (t === 'code') outputs = [await runCode(node, input, state, wf.name)];
      else if (t === 'httpRequest' || t === 'twilio') {
        const out = [];
        for (const it of input) {
          const ctx = { $json: it.json, $: makeDollar(state, it.lin) };
          let req;
          if (t === 'twilio') req = { to: evalExpr(node.parameters.to, ctx), from: evalExpr(node.parameters.from, ctx), message: evalExpr(node.parameters.message, ctx) };
          else {
            req = { method: evalExpr(node.parameters.method, ctx), url: evalExpr(node.parameters.url, ctx), headers: {} };
            for (const h of (node.parameters.headerParameters && node.parameters.headerParameters.parameters) || []) req.headers[h.name] = evalExpr(h.value, ctx);
            if (node.parameters.sendBody) req.body = JSON.parse(evalExpr(node.parameters.jsonBody, ctx));
            req.credential = node.credentials ? Object.values(node.credentials)[0].name : null;
          }
          result.calls.push({ node: name, req });
          const mock = mocks[name];
          if (!mock) throw new Error(`No mock for HTTP node "${name}" (${req.url || req.to})`);
          const res = await mock(req, it.json);
          const json = t === 'twilio' ? (res || { sid: 'SMsim' }) : { statusCode: res && res.statusCode !== undefined ? res.statusCode : 200, body: res && res.body !== undefined ? res.body : res, headers: {} };
          out.push({ json, lin: { ...it.lin } });
        }
        outputs = [out];
      } else if (t === 'if') {
        const cond = node.parameters.conditions.conditions[0];
        outputs = [[], []];
        for (const it of input) {
          const v = evalExpr(cond.leftValue, { $json: it.json, $: makeDollar(state, it.lin) });
          outputs[v === true || v === 'true' ? 0 : 1].push(it);
        }
      } else if (t === 'switch') {
        outputs = Array.from({ length: node.parameters.numberOutputs }, () => []);
        for (const it of input) {
          const idx = Number(evalExpr(node.parameters.output, { $json: it.json, $: makeDollar(state, it.lin) }));
          if (!(idx >= 0 && idx < outputs.length)) throw new Error(`Switch ${name}: route ${idx} out of range`);
          outputs[idx].push(it);
        }
      } else if (t === 'respondToWebhook') {
        const it = input[0];
        const body = evalExpr(node.parameters.responseBody, { $json: it.json, $: makeDollar(state, it.lin) });
        result.responses.push({ node: name, body, respondWith: node.parameters.respondWith, headers: node.parameters.options && node.parameters.options.responseHeaders });
        outputs = [input];
      } else throw new Error(`simulate: unsupported node type ${node.type}`);
    } catch (e) {
      result.errors.push({ node: name, message: e.message });
      return result;
    }
    // tag lineage with this node's own output
    outputs.forEach((arr) => arr.forEach((it) => { it.lin = { ...it.lin, [name]: it.json }; }));
    state.outputs[name] = outputs.flat();
    const conns = (wf.connections[name] && wf.connections[name].main) || [];
    conns.forEach((targets, outIdx) => {
      for (const tgt of targets || []) if (outputs[outIdx] && outputs[outIdx].length) queue.push({ node: tgt.node, items: outputs[outIdx].map((x) => ({ json: x.json, lin: x.lin })) });
    });
  }
  return result;
}

module.exports = { simulate, evalExpr };
