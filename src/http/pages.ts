/** Public HTML served at / (commercial landing) and /docs (Scalar API reference). */

export const docsHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Courant WhatsApp API — Reference</title>
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
  <title>Courant WhatsApp API — self-hosted WhatsApp messaging, no BSP</title>
  <meta name="description" content="A multi-session WhatsApp API you can self-host. Pair your own numbers, send with human-like pacing, receive replies on a webhook. No BSP, no per-message fees." />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E%F0%9F%92%AC%3C/text%3E%3C/svg%3E" />
  <style>
    :root{--bg:#0a0e0f;--panel:#111819;--panel2:#0d1415;--line:#1e2a2c;--line2:#294043;--fg:#e9f0f1;--muted:#90a6ab;--accent:#25d366;--accent2:#128c7e;--warn:#f0b64b;--radius:14px}
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{margin:0;font:16px/1.65 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg);
      background-image:radial-gradient(70rem 50rem at 85% -15%,rgba(37,211,102,.10),transparent 55%),radial-gradient(60rem 40rem at -10% 10%,rgba(18,140,126,.08),transparent 55%)}
    a{color:inherit}
    .wrap{max-width:1040px;margin:0 auto;padding:0 20px}
    /* nav */
    header.nav{position:sticky;top:0;z-index:50;backdrop-filter:blur(10px);background:rgba(10,14,15,.72);border-bottom:1px solid var(--line)}
    .nav .wrap{display:flex;align-items:center;gap:20px;height:62px}
    .brand{display:flex;align-items:center;gap:9px;font-weight:800;letter-spacing:-.01em;text-decoration:none}
    .brand .dotmark{width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px rgba(37,211,102,.7)}
    .nav nav{margin-left:auto;display:flex;align-items:center;gap:22px}
    .nav nav a{color:var(--muted);text-decoration:none;font-size:14px;font-weight:500}
    .nav nav a:hover{color:var(--fg)}
    .btn{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-weight:700;font-size:14px;padding:10px 16px;border-radius:10px;border:1px solid var(--line2);background:var(--panel);color:var(--fg);cursor:pointer;transition:.15s}
    .btn:hover{border-color:var(--accent2)}
    .btn.primary{background:linear-gradient(180deg,var(--accent),var(--accent2));color:#04110b;border-color:transparent}
    .btn.primary:hover{filter:brightness(1.05)}
    .btn.lg{padding:13px 22px;font-size:15px}
    @media(max-width:720px){.nav nav a.hide{display:none}}
    /* hero */
    .hero{padding:66px 0 40px;text-align:center}
    .badge{display:inline-flex;align-items:center;gap:8px;padding:5px 13px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:13px}
    .dot{width:8px;height:8px;border-radius:50%;background:var(--muted)}
    .dot.ok{background:var(--accent);animation:pulse 2s infinite}
    .dot.off{background:#e5533c}
    @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(37,211,102,.5)}70%{box-shadow:0 0 0 8px rgba(37,211,102,0)}100%{box-shadow:0 0 0 0 rgba(37,211,102,0)}}
    h1{font-size:clamp(34px,6.5vw,60px);line-height:1.05;letter-spacing:-.03em;margin:22px auto 16px;max-width:16ch}
    .mark{background:linear-gradient(90deg,var(--accent),#7af0a6);-webkit-background-clip:text;background-clip:text;color:transparent}
    .sub{color:var(--muted);font-size:clamp(16px,2.4vw,20px);max-width:60ch;margin:0 auto 30px}
    .cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
    .pills{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:28px;color:var(--muted);font-size:13px}
    .pill{border:1px solid var(--line);border-radius:999px;padding:6px 13px}
    .pill b{color:var(--fg);font-weight:700}
    /* sections */
    section{padding:56px 0;border-top:1px solid var(--line)}
    .eyebrow{color:var(--accent);font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase}
    h2{font-size:clamp(26px,4vw,38px);letter-spacing:-.02em;margin:10px 0 10px}
    .lead{color:var(--muted);max-width:62ch;margin:0 0 30px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
    .card{border:1px solid var(--line);background:var(--panel);border-radius:var(--radius);padding:20px}
    .card h3{margin:0 0 8px;font-size:16px;display:flex;align-items:center;gap:9px}
    .card p{margin:0;color:var(--muted);font-size:14px}
    .ic{width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:rgba(37,211,102,.12);color:var(--accent);font-size:15px}
    .steps{counter-reset:s;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
    .step{position:relative;border:1px solid var(--line);background:var(--panel);border-radius:var(--radius);padding:22px 20px 20px}
    .step:before{counter-increment:s;content:counter(s);display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:linear-gradient(180deg,var(--accent),var(--accent2));color:#04110b;font-weight:800;margin-bottom:12px}
    .step h3{margin:0 0 6px;font-size:16px}.step p{margin:0;color:var(--muted);font-size:14px}
    pre{background:#070c0d;border:1px solid var(--line);border-radius:12px;padding:18px 20px;overflow:auto;font:13.5px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cfe8d8}
    .tok{color:var(--accent)}
    /* form */
    .formwrap{display:grid;grid-template-columns:1.1fr .9fr;gap:34px;align-items:start}
    @media(max-width:800px){.formwrap{grid-template-columns:1fr}}
    form.key{border:1px solid var(--line2);background:var(--panel);border-radius:16px;padding:24px}
    label{display:block;font-size:13px;font-weight:600;color:var(--fg);margin:14px 0 6px}
    label:first-child{margin-top:0}
    input,select,textarea{width:100%;background:var(--panel2);border:1px solid var(--line2);border-radius:10px;color:var(--fg);font:inherit;font-size:14px;padding:11px 13px;outline:none;transition:.15s}
    input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(37,211,102,.15)}
    textarea{resize:vertical;min-height:84px}
    .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
    .req{color:var(--accent)}
    .formnote{color:var(--muted);font-size:12.5px;margin-top:12px}
    .msg{margin-top:14px;font-size:14px;display:none;border-radius:10px;padding:11px 13px}
    .msg.ok{display:block;background:rgba(37,211,102,.1);border:1px solid var(--accent2);color:#bdf0cf}
    .msg.err{display:block;background:rgba(229,83,60,.1);border:1px solid #7a3328;color:#f3b5a9}
    .selling li{color:var(--muted);margin:0 0 12px;padding-left:26px;position:relative;list-style:none}
    .selling ul{padding:0;margin:0}
    .selling li:before{content:"✓";position:absolute;left:0;color:var(--accent);font-weight:800}
    .warn{color:var(--warn);font-size:13px;border:1px solid #4a3a16;background:rgba(240,182,75,.07);border-radius:10px;padding:11px 14px;margin-top:22px}
    footer{border-top:1px solid var(--line);padding:26px 0 40px;color:var(--muted);font-size:13px}
    footer .wrap{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center}
    footer a{color:var(--muted);text-decoration:none}footer a:hover{color:var(--fg)}
  </style>
</head>
<body>
  <header class="nav"><div class="wrap">
    <a class="brand" href="/"><span class="dotmark"></span>Courant <span style="color:var(--muted);font-weight:600">WhatsApp API</span></a>
    <nav>
      <a class="hide" href="#features">Features</a>
      <a class="hide" href="#how">How it works</a>
      <a href="/docs">Docs</a>
      <a class="btn primary" href="#get">Get an API key</a>
    </nav>
  </div></header>

  <div class="wrap">
    <section class="hero" style="border-top:none">
      <span class="badge"><span id="dot" class="dot"></span><span id="state">checking…</span></span>
      <h1>WhatsApp messaging, <span class="mark">on your terms</span>.</h1>
      <p class="sub">A self-hosted, multi-session WhatsApp API. Pair your own numbers, send with
        human-like pacing, and receive replies on a signed webhook — no BSP, no approval queue,
        <b style="color:var(--fg)">no per-message fees</b>.</p>
      <div class="cta">
        <a class="btn primary lg" href="#get">Get an API key →</a>
        <a class="btn lg" href="/docs">Read the docs</a>
      </div>
      <div class="pills">
        <span class="pill"><b>Multi-number</b> in one API</span>
        <span class="pill"><b>Async</b> send &amp; webhooks</span>
        <span class="pill"><b>Self-hosted</b> — your data</span>
        <span class="pill"><b>Flat</b> pricing</span>
      </div>
    </section>

    <section id="features">
      <span class="eyebrow">Why Courant</span>
      <h2>Everything you need to send WhatsApp at scale</h2>
      <p class="lead">Built on a battle-tested engine, wrapped in a clean HTTP API. The hard parts —
        pacing, reconnection, durability, deliverability — are handled for you.</p>
      <div class="grid">
        <div class="card"><h3><span class="ic">📱</span>Multi-session</h3><p>Pair many numbers in one worker, each addressed by id with its own queue and QR. Rotate numbers to spread load.</p></div>
        <div class="card"><h3><span class="ic">⚡</span>Async API</h3><p>Queue a message, get a job id instantly, then poll or receive a webhook. The worker paces delivery for you.</p></div>
        <div class="card"><h3><span class="ic">🛡️</span>Human pacing</h3><p>Typing simulation, randomized delays, daily caps, warm-up ramps and per-recipient gaps — to look human, not a blaster.</p></div>
        <div class="card"><h3><span class="ic">💾</span>Durable</h3><p>A disk-backed queue per number survives restarts and retries transient failures. Idempotent by your own key.</p></div>
        <div class="card"><h3><span class="ic">🔔</span>Signed webhooks</h3><p>Inbound messages and delivery status pushed to your endpoint, HMAC-signed, tagged with the session id.</p></div>
        <div class="card"><h3><span class="ic">🖼️</span>Text &amp; media</h3><p>Send plain text or media by URL/base64 with captions. Validate numbers before you message them.</p></div>
      </div>
    </section>

    <section id="how">
      <span class="eyebrow">How it works</span>
      <h2>Live in three steps</h2>
      <div class="steps">
        <div class="step"><h3>Request a key</h3><p>Fill the form below. We review and send your API key — no self-serve approval queue.</p></div>
        <div class="step"><h3>Pair a number</h3><p>Create a session and scan the QR once from WhatsApp → Linked devices. The session persists.</p></div>
        <div class="step"><h3>Send &amp; receive</h3><p>POST messages to the API; get replies and delivery status on your webhook. That's it.</p></div>
      </div>
      <pre style="margin-top:26px"><code>curl -X POST https://wa.yaasiin.dev/api/v1/sessions/<span class="tok">&lt;id&gt;</span>/messages \\
  -H "<span class="tok">X-API-Key</span>: wa_your_key" -H "Content-Type: application/json" \\
  -d '{ "to": "+22890000000", "text": "Hello 👋" }'</code></pre>
    </section>

    <section id="get">
      <span class="eyebrow">Get started</span>
      <h2>Request your API key</h2>
      <div class="formwrap">
        <form class="key" id="keyForm">
          <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />
          <label>Name <span class="req">*</span></label>
          <input name="name" required maxlength="120" placeholder="Jane Doe" />
          <label>Work email <span class="req">*</span></label>
          <input name="email" type="email" required maxlength="160" placeholder="jane@company.com" />
          <label>Company</label>
          <input name="company" maxlength="120" placeholder="Acme Inc." />
          <label>Expected volume</label>
          <select name="volume">
            <option value="">Select…</option>
            <option>Under 1,000 / month</option>
            <option>1,000 – 10,000 / month</option>
            <option>10,000 – 100,000 / month</option>
            <option>Over 100,000 / month</option>
          </select>
          <label>What will you use it for?</label>
          <textarea name="useCase" maxlength="1000" placeholder="Notifications, support, reminders, outreach…"></textarea>
          <button class="btn primary lg" type="submit" id="submitBtn" style="width:100%;justify-content:center;margin-top:18px">Request API key</button>
          <p class="formnote">We'll email you to set things up. We never sell your data.</p>
          <div class="msg" id="formMsg"></div>
        </form>
        <div class="selling">
          <h3 style="margin:0 0 14px">What you get</h3>
          <ul>
            <li>Your own API key, scoped and revocable.</li>
            <li>Multi-number support from day one.</li>
            <li>Webhooks for replies &amp; delivery status.</li>
            <li>Full <a href="/docs" style="color:var(--accent)">API reference</a> and examples.</li>
            <li>Flat pricing — no per-message fees.</li>
          </ul>
          <div class="warn">⚠️ This is an <b>unofficial</b> WhatsApp API and is against WhatsApp's Terms of Service. Use it for low-volume, opt-in / human-assisted messaging. You are responsible for consent and opt-out.</div>
        </div>
      </div>
    </section>
  </div>

  <footer><div class="wrap">
    <span>© ${new Date().getFullYear()} Courant</span>
    <a href="/docs">Docs</a>
    <a href="/openapi.json">OpenAPI</a>
    <a href="/health">Status</a>
    <a href="https://github.com/yaasiin-ayeva/courant-whatsapp" target="_blank" rel="noopener">GitHub</a>
  </div></footer>

  <script>
    (function(){
      fetch('/health').then(function(r){return r.json()}).then(function(d){
        var dot=document.getElementById('dot'),st=document.getElementById('state'),n=d.sessions||0,c=d.connected||0
        if(c>0){dot.className='dot ok';st.textContent=c+' number'+(c>1?'s':'')+' live'}
        else if(n>0){dot.className='dot off';st.textContent='Service online'}
        else{dot.className='dot ok';st.textContent='Service online'}
      }).catch(function(){document.getElementById('dot').className='dot off';document.getElementById('state').textContent='Service offline'})

      var f=document.getElementById('keyForm'),btn=document.getElementById('submitBtn'),msg=document.getElementById('formMsg')
      f.addEventListener('submit',function(e){
        e.preventDefault()
        msg.className='msg';msg.style.display='none'
        var data={};new FormData(f).forEach(function(v,k){data[k]=v})
        btn.disabled=true;var old=btn.textContent;btn.textContent='Sending…'
        fetch('/api/v1/request-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
          .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
          .then(function(res){
            if(res.ok){f.reset();msg.className='msg ok';msg.textContent='Thanks! Your request is on its way — we'+String.fromCharCode(39)+'ll be in touch by email shortly.'}
            else{msg.className='msg err';msg.textContent=(res.j&&res.j.error)||'Something went wrong. Please try again.'}
          })
          .catch(function(){msg.className='msg err';msg.textContent='Network error. Please try again.'})
          .finally(function(){btn.disabled=false;btn.textContent=old})
      })
    })()
  </script>
</body>
</html>`
