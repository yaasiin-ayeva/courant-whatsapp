/** Public HTML served at / (landing) and /docs (Scalar API reference). */

export const docsHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Courant WhatsApp Worker — API Reference</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E%F0%9F%92%AC%3C/text%3E%3C/svg%3E" />
</head>
<body>
  <script id="api-reference" data-url="/openapi.json"></script>
  <script>
    var c = document.getElementById('api-reference')
    c.dataset.configuration = JSON.stringify({ theme: 'default', layout: 'modern', hideDownloadButton: false })
  </script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`

export const landingHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Courant WhatsApp Worker</title>
  <meta name="description" content="Standalone WhatsApp transport for Courant — self-hosted, no vendor, HTTP API." />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E%F0%9F%92%AC%3C/text%3E%3C/svg%3E" />
  <style>
    :root { --bg:#0b0f10; --panel:#11181a; --line:#1f2a2d; --fg:#e6edf0; --muted:#8aa0a6; --accent:#25d366; --accent-2:#128c7e; }
    * { box-sizing: border-box; }
    body { margin:0; font:15px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:var(--fg); background:var(--bg);
      background-image: radial-gradient(60rem 60rem at 80% -10%, rgba(37,211,102,.08), transparent 60%); }
    .wrap { max-width: 860px; margin: 0 auto; padding: 72px 20px 56px; }
    .badge { display:inline-flex; align-items:center; gap:8px; padding:5px 12px; border:1px solid var(--line); border-radius:999px; color:var(--muted); font-size:13px; }
    .dot { width:8px; height:8px; border-radius:50%; background:var(--muted); box-shadow:0 0 0 0 rgba(37,211,102,.5); }
    .dot.ok { background:var(--accent); animation: pulse 2s infinite; }
    .dot.off { background:#e5533c; }
    @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(37,211,102,.5)} 70%{box-shadow:0 0 0 8px rgba(37,211,102,0)} 100%{box-shadow:0 0 0 0 rgba(37,211,102,0)} }
    h1 { font-size: clamp(28px, 6vw, 44px); line-height:1.1; letter-spacing:-.02em; margin: 22px 0 10px; }
    .mark { color: var(--accent); }
    p.lead { color: var(--muted); font-size: 17px; max-width: 60ch; margin: 0 0 28px; }
    .row { display:flex; flex-wrap:wrap; gap:12px; margin: 8px 0 36px; }
    a.btn { text-decoration:none; font-weight:600; font-size:14px; padding:11px 18px; border-radius:10px; border:1px solid var(--line); color:var(--fg); background:var(--panel); transition:.15s; }
    a.btn:hover { border-color:var(--accent-2); }
    a.btn.primary { background:linear-gradient(180deg,var(--accent),var(--accent-2)); color:#04110b; border-color:transparent; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; margin: 8px 0 36px; }
    .card { border:1px solid var(--line); background:var(--panel); border-radius:14px; padding:16px 18px; }
    .card h3 { margin:0 0 6px; font-size:14px; }
    .card p { margin:0; color:var(--muted); font-size:13px; }
    pre { background:#0a1013; border:1px solid var(--line); border-radius:12px; padding:16px 18px; overflow:auto; font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; color:#cfe8d8; }
    .tok { color:var(--accent); }
    footer { color:var(--muted); font-size:13px; border-top:1px solid var(--line); margin-top:40px; padding-top:18px; display:flex; flex-wrap:wrap; gap:6px 16px; }
    footer a { color:var(--muted); }
    .warn { color:#f0b64b; }
  </style>
</head>
<body>
  <div class="wrap">
    <span class="badge"><span id="dot" class="dot"></span><span id="state">checking…</span></span>
    <h1>Courant <span class="mark">WhatsApp</span> Worker</h1>
    <p class="lead">A standalone WhatsApp transport built on whatsapp-web.js. Pairs one real
      number, sends with human-like pacing through a durable queue, and forwards replies to a
      signed webhook. No vendor, no BSP, no per-message cost.</p>

    <div class="row">
      <a class="btn primary" href="/docs">API Reference →</a>
      <a class="btn" href="https://github.com/yaasiin-ayeva/courant-whatsapp" target="_blank" rel="noopener">GitHub</a>
      <a class="btn" href="/openapi.json">OpenAPI</a>
    </div>

    <div class="grid">
      <div class="card"><h3>Async API</h3><p>Queue a message, get a job id, poll status or receive a webhook.</p></div>
      <div class="card"><h3>Durable + paced</h3><p>Survives restarts; typing simulation, caps, warm-up and per-recipient gaps.</p></div>
      <div class="card"><h3>Key auth</h3><p>Every call carries <code>X-API-Key</code>. Pair once via QR, session persists.</p></div>
    </div>

    <pre><code>curl -X POST https://wa.yaasiin.dev/api/v1/messages \\
  -H "<span class="tok">X-API-Key</span>: wa_your_key" -H "Content-Type: application/json" \\
  -d '{ "to": "+22890000000", "text": "Hello 👋" }'</code></pre>

    <p class="lead warn" style="font-size:13px">⚠️ Unofficial and against WhatsApp’s Terms of Service — low-volume, opt-in / human-assisted use only.</p>

    <footer>
      <span>© ${new Date().getFullYear()} Courant</span>
      <a href="/docs">Docs</a>
      <a href="/health">Health</a>
      <a href="https://github.com/yaasiin-ayeva/courant-whatsapp" target="_blank" rel="noopener">Source</a>
    </footer>
  </div>

  <script>
    fetch('/health').then(function (r) { return r.json() }).then(function (d) {
      var dot = document.getElementById('dot'), st = document.getElementById('state')
      if (d.ready) { dot.className = 'dot ok'; st.textContent = 'Connected' }
      else { dot.className = 'dot off'; st.textContent = 'Not paired' }
    }).catch(function () {
      document.getElementById('dot').className = 'dot off'
      document.getElementById('state').textContent = 'Unreachable'
    })
  </script>
</body>
</html>`
