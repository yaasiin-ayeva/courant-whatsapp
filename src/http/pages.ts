/** Public HTML served at / (commercial landing, Explee-style) and /docs (Scalar). */

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
  <meta name="description" content="A multi-session WhatsApp API you can self-host. Pair your own numbers, send with human-like pacing, receive replies on a signed webhook. No BSP, no per-message fees." />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='18' font-size='18'%3E%F0%9F%92%AC%3C/text%3E%3C/svg%3E" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    :root{--bg:#f6f5f2;--card:#ffffff;--ink:#0f1113;--muted:#6b7280;--soft:#9aa1ab;--line:#e7e5df;--line2:#dcdad2;--pill:#efeee9;--accent:#18a558;--accent-dk:#128a49;--accent-soft:#e7f6ee;--warn-bg:#fff7e6;--warn-line:#f0d79a;--warn-ink:#8a6414;--radius:18px}
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.6;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
    a{color:inherit}
    .wrap{max-width:1060px;margin:0 auto;padding:0 22px}
    /* nav */
    header.nav{position:sticky;top:0;z-index:50;background:rgba(246,245,242,.82);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
    .nav .wrap{display:flex;align-items:center;gap:22px;height:66px}
    .brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:20px;letter-spacing:-.02em;text-decoration:none}
    .brand .m{width:16px;height:16px;border-radius:5px;background:linear-gradient(135deg,var(--accent),#49d08a)}
    .brand span{color:var(--soft);font-weight:600;font-size:15px}
    .nav nav{margin-left:auto;display:flex;align-items:center;gap:26px}
    .nav nav a{color:#3a3f46;text-decoration:none;font-size:15px;font-weight:500}
    .nav nav a:hover{color:var(--ink)}
    .btn{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-weight:700;font-size:15px;padding:11px 18px;border-radius:12px;border:1px solid var(--ink);background:var(--ink);color:#fff;cursor:pointer;transition:.15s}
    .btn:hover{opacity:.88}
    .btn.ghost{background:#fff;color:var(--ink);border-color:var(--line2)}
    .btn.ghost:hover{border-color:var(--ink);opacity:1}
    .btn.green{background:var(--accent);border-color:var(--accent);color:#fff}
    .btn.green:hover{background:var(--accent-dk);border-color:var(--accent-dk);opacity:1}
    .btn.lg{padding:14px 24px;font-size:16px;border-radius:14px}
    @media(max-width:760px){.nav nav a.hide{display:none}}
    /* hero */
    .hero{padding:72px 0 30px;text-align:center}
    .badge{display:inline-flex;align-items:center;gap:9px;padding:7px 15px;background:#fff;border:1px solid var(--line);border-radius:999px;font-size:14px;color:#3a3f46;box-shadow:0 1px 2px rgba(16,17,19,.04)}
    .badge b{font-weight:800;color:var(--ink)}
    .dot{width:8px;height:8px;border-radius:50%;background:var(--soft)}
    .dot.ok{background:var(--accent);animation:pulse 2s infinite}
    .dot.off{background:#e0624a}
    @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(24,165,88,.45)}70%{box-shadow:0 0 0 7px rgba(24,165,88,0)}100%{box-shadow:0 0 0 0 rgba(24,165,88,0)}}
    h1{font-size:clamp(40px,7.5vw,74px);line-height:1.02;letter-spacing:-.035em;font-weight:800;margin:24px auto 18px;max-width:14ch}
    .mark{color:var(--accent)}
    .sub{color:var(--muted);font-size:clamp(17px,2.3vw,21px);max-width:58ch;margin:0 auto 26px}
    .herocta{max-width:560px;margin:0 auto}
    .inputrow{display:flex;gap:10px;background:#fff;border:2px solid var(--ink);border-radius:16px;padding:7px 7px 7px 8px;box-shadow:0 10px 30px rgba(16,17,19,.08)}
    .inputrow input{flex:1;border:none;outline:none;background:transparent;font:inherit;font-size:16px;color:var(--ink);padding:0 10px}
    .inputrow input::placeholder{color:var(--soft)}
    .inputrow button{white-space:nowrap}
    .pills{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:18px auto 0;color:#4b5159;font-size:14px}
    .pill{background:var(--pill);border-radius:999px;padding:8px 15px}
    .pill b{color:var(--ink);font-weight:700}
    /* sections */
    section{padding:62px 0}
    .center{text-align:center}
    .eyebrow{color:var(--accent);font-weight:800;font-size:13px;letter-spacing:.09em;text-transform:uppercase}
    h2{font-size:clamp(30px,4.6vw,46px);letter-spacing:-.03em;font-weight:800;margin:12px 0 12px}
    .lead{color:var(--muted);max-width:60ch;margin:0 0 34px;font-size:17px}
    .center .lead{margin-left:auto;margin-right:auto}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
    .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px;box-shadow:0 1px 2px rgba(16,17,19,.03)}
    .card h3{margin:0 0 9px;font-size:17px;font-weight:700;display:flex;align-items:center;gap:11px}
    .card p{margin:0;color:var(--muted);font-size:15px}
    .ic{width:38px;height:38px;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;background:var(--accent-soft);color:var(--accent-dk);font-size:18px;flex:none}
    .steps{counter-reset:s;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}
    .step{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px 24px;box-shadow:0 1px 2px rgba(16,17,19,.03)}
    .step:before{counter-increment:s;content:counter(s);display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:var(--accent);color:#fff;font-weight:800;font-size:18px;margin-bottom:14px}
    .step h3{margin:0 0 7px;font-size:17px;font-weight:700}.step p{margin:0;color:var(--muted);font-size:15px}
    pre{background:#0f1113;border-radius:16px;padding:22px;overflow:auto;font:14px/1.75 ui-monospace,SFMono-Regular,Menlo,monospace;color:#d9e7df;box-shadow:0 12px 30px rgba(16,17,19,.12)}
    .tok{color:#49d08a}
    /* form */
    .formwrap{display:grid;grid-template-columns:1.05fr .95fr;gap:38px;align-items:start}
    @media(max-width:820px){.formwrap{grid-template-columns:1fr}}
    form.key{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:28px;box-shadow:0 10px 30px rgba(16,17,19,.06)}
    label{display:block;font-size:13px;font-weight:600;color:var(--ink);margin:16px 0 6px}
    label:first-of-type{margin-top:0}
    input.f,select,textarea{width:100%;background:#fcfcfb;border:1px solid var(--line2);border-radius:12px;color:var(--ink);font:inherit;font-size:15px;padding:12px 14px;outline:none;transition:.15s}
    input.f:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
    textarea{resize:vertical;min-height:90px}
    .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
    .req{color:var(--accent)}
    .formnote{color:var(--soft);font-size:12.5px;margin-top:13px}
    .msg{margin-top:15px;font-size:14.5px;display:none;border-radius:12px;padding:12px 14px}
    .msg.ok{display:block;background:var(--accent-soft);border:1px solid #bfe6cf;color:var(--accent-dk)}
    .msg.err{display:block;background:#fdecea;border:1px solid #f3c4bb;color:#b4412f}
    .selling h3{margin:0 0 16px;font-size:20px;font-weight:800;letter-spacing:-.01em}
    .selling ul{padding:0;margin:0;list-style:none}
    .selling li{color:#434852;margin:0 0 13px;padding-left:28px;position:relative;font-size:15.5px}
    .selling li:before{content:"✓";position:absolute;left:0;color:var(--accent);font-weight:800}
    .warn{color:var(--warn-ink);font-size:13.5px;border:1px solid var(--warn-line);background:var(--warn-bg);border-radius:12px;padding:13px 15px;margin-top:22px}
    footer{border-top:1px solid var(--line);padding:30px 0 46px;color:var(--muted);font-size:14px;margin-top:20px}
    footer .wrap{display:flex;flex-wrap:wrap;gap:8px 22px;align-items:center}
    footer a{color:var(--muted);text-decoration:none}footer a:hover{color:var(--ink)}
  </style>
</head>
<body>
  <header class="nav"><div class="wrap">
    <a class="brand" href="/"><span class="m"></span>courant <span>WhatsApp API</span></a>
    <nav>
      <a class="hide" href="#features">Features</a>
      <a class="hide" href="#how">How it works</a>
      <a href="/docs">Docs</a>
      <a class="btn green" href="#get">Get an API key</a>
    </nav>
  </div></header>

  <div class="wrap">
    <section class="hero">
      <span class="badge"><span id="dot" class="dot"></span><span id="state">checking…</span></span>
      <h1>Your own <span class="mark">WhatsApp API</span>, in minutes.</h1>
      <p class="sub">Self-hosted and multi-session. Pair your own numbers, send with human-like
        pacing, and get replies on a signed webhook — no BSP, no approval queue, no per-message fees.</p>
      <div class="herocta">
        <form id="heroForm" class="inputrow">
          <input id="heroEmail" type="email" placeholder="Enter your work email" aria-label="Your work email" />
          <button class="btn green" type="submit">Get an API key →</button>
        </form>
      </div>
      <div class="pills">
        <span class="pill"><b>Multi-number</b> in one API</span>
        <span class="pill"><b>Async</b> send &amp; webhooks</span>
        <span class="pill"><b>Flat</b> pricing</span>
      </div>
    </section>

    <section id="features">
      <span class="eyebrow">Why Courant</span>
      <h2>Everything you need to send WhatsApp at scale</h2>
      <p class="lead">A battle-tested engine behind a clean HTTP API. The hard parts — pacing,
        reconnection, durability, deliverability — are handled for you.</p>
      <div class="grid">
        <div class="card"><h3><span class="ic">📱</span>Multi-session</h3><p>Pair many numbers in one worker, each with its own queue and QR. Rotate numbers to spread load.</p></div>
        <div class="card"><h3><span class="ic">⚡</span>Async API</h3><p>Queue a message, get a job id instantly, then poll or receive a webhook. The worker paces delivery.</p></div>
        <div class="card"><h3><span class="ic">🛡️</span>Human pacing</h3><p>Typing simulation, randomized delays, daily caps, warm-up ramps and per-recipient gaps.</p></div>
        <div class="card"><h3><span class="ic">💾</span>Durable</h3><p>A disk-backed queue per number survives restarts and retries transient failures. Idempotent by your key.</p></div>
        <div class="card"><h3><span class="ic">🔔</span>Signed webhooks</h3><p>Inbound messages and delivery status pushed to your endpoint, HMAC-signed, tagged with the session id.</p></div>
        <div class="card"><h3><span class="ic">🖼️</span>Text &amp; media</h3><p>Send plain text or media by URL/base64 with captions. Validate numbers before messaging them.</p></div>
      </div>
    </section>

    <section id="how" class="center">
      <span class="eyebrow">How it works</span>
      <h2>Live in three steps</h2>
      <p class="lead">From request to first message in an afternoon.</p>
      <div class="steps" style="text-align:left">
        <div class="step"><h3>Request a key</h3><p>Fill the form below. We review and send your API key — no self-serve approval queue.</p></div>
        <div class="step"><h3>Pair a number</h3><p>Create a session and scan the QR once from WhatsApp → Linked devices. It persists.</p></div>
        <div class="step"><h3>Send &amp; receive</h3><p>POST messages to the API; get replies and delivery status on your webhook.</p></div>
      </div>
      <pre style="margin-top:28px;text-align:left"><code>curl -X POST https://wa.yaasiin.dev/api/v1/sessions/<span class="tok">&lt;id&gt;</span>/messages \\
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
          <input class="f" name="name" required maxlength="120" placeholder="Jane Doe" />
          <label>Work email <span class="req">*</span></label>
          <input class="f" name="email" type="email" required maxlength="160" placeholder="jane@company.com" />
          <label>Company</label>
          <input class="f" name="company" maxlength="120" placeholder="Acme Inc." />
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
          <button class="btn green lg" type="submit" id="submitBtn" style="width:100%;justify-content:center;margin-top:20px">Request API key</button>
          <p class="formnote">We'll email you to set things up. We never sell your data.</p>
          <div class="msg" id="formMsg"></div>
        </form>
        <div class="selling">
          <h3>What you get</h3>
          <ul>
            <li>Your own API key, scoped and revocable.</li>
            <li>Multi-number support from day one.</li>
            <li>Webhooks for replies &amp; delivery status.</li>
            <li>Full <a href="/docs" style="color:var(--accent-dk);font-weight:600">API reference</a> and examples.</li>
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
        var dot=document.getElementById('dot'),st=document.getElementById('state'),c=d.connected||0
        if(c>0){dot.className='dot ok';st.textContent=c+' number'+(c>1?'s':'')+' live'}
        else{dot.className='dot ok';st.textContent='Service online'}
      }).catch(function(){document.getElementById('dot').className='dot off';document.getElementById('state').textContent='Service offline'})

      // Hero email → jump to the full form, pre-filled.
      var hf=document.getElementById('heroForm'),he=document.getElementById('heroEmail')
      hf.addEventListener('submit',function(e){
        e.preventDefault()
        var em=(he.value||'').trim()
        var target=document.querySelector('#keyForm [name=email]')
        if(em&&target)target.value=em
        document.getElementById('get').scrollIntoView({behavior:'smooth'})
        setTimeout(function(){var n=document.querySelector('#keyForm [name=name]');if(n)n.focus()},500)
      })

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
