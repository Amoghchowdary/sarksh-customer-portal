
"use strict";

/*
  SARKSH Portal V2
  One frontend JavaScript bundle for every GitHub Pages screen.
  Change only BACKEND_URL after deploying Google Apps Script.
*/
(() => {
  const CONFIG = {
    BACKEND_URL: "https://script.google.com/macros/s/AKfycbzvnPVHqRKhJZO8Qd3vtyF0K5_rYYwYTDWXCBZAZZFAZjqgTsBnx1dux6d2KM0PjYGkNA/exec",
    APP_NAME: "SARKSH Portal",
    VIDEO_MAX_MB: 3,
    BUILD: "8.0.0"
  };


  const RTC_CONFIG = {
    iceServers: [
      {urls:"stun:stun.l.google.com:19302"},
      {urls:"stun:stun1.l.google.com:19302"}
    ]
  };

  const CUSTOMER_KEY = "sarksh_customer_session";
  const ADMIN_KEY = "sarksh_admin_session";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => (
    {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]
  ));
  const money = (n) => new Intl.NumberFormat("en-IN", {
    style:"currency", currency:"INR", maximumFractionDigits:2
  }).format(Number(n || 0));
  const fmt = (x) => x ? new Date(x).toLocaleString("en-IN") : "—";

  async function api(action, payload = {}) {
    if(!CONFIG.BACKEND_URL || CONFIG.BACKEND_URL.includes("PASTE_")) throw new Error("Backend URL is not configured.");
    const reads=new Set(["customerDashboard","customerTrades","getKycCenter","customerMeetKycStatus","customerSettingsGet","customerTeam","customerAgreementGet","registrationResumeStatus","getRegistrationAgreement","liveKycStatus","adminDashboard","adminCustomers","adminCustomerDashboard","adminKycQueue","adminTrades","adminAccounts","adminMonitoring","adminAudit","adminKycAvailabilityGet","agentLiveKycQueue","adminAgreementGet","adminListAdmins"]);
    const attempts=reads.has(action)?2:1;let last=null;
    for(let i=1;i<=attempts;i++){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);try{const response=await fetch(CONFIG.BACKEND_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action,request_id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),client_build:CONFIG.BUILD,...payload}),redirect:"follow",cache:"no-store",signal:controller.signal});if(!response.ok)throw new Error(`Backend HTTP ${response.status}`);const data=await response.json();if(!data||data.ok!==true)throw new Error(data?.error||"Backend request failed.");return data;}catch(err){last=err.name==="AbortError"?new Error("Backend request timed out."):err;if(i<attempts)await new Promise(r=>setTimeout(r,450));}finally{clearTimeout(timeout);}}
    throw last||new Error("Backend request failed.");
  }


  const Session = {
    getCustomer: () => localStorage.getItem(CUSTOMER_KEY),
    getAdmin: () => localStorage.getItem(ADMIN_KEY),
    setCustomer: (t) => localStorage.setItem(CUSTOMER_KEY, t),
    setAdmin: (t) => localStorage.setItem(ADMIN_KEY, t),
    clearCustomer: () => localStorage.removeItem(CUSTOMER_KEY),
    clearAdmin: () => localStorage.removeItem(ADMIN_KEY),
    clearAll: () => { localStorage.removeItem(CUSTOMER_KEY); localStorage.removeItem(ADMIN_KEY); }
  };

  function isAdminPage() { return location.pathname.includes("/admin/"); }
  function requireCustomer() {
    const token = Session.getCustomer();
    if (!token) { location.href = "login.html"; return null; }
    return token;
  }
  function requireAdmin() {
    const token = Session.getAdmin();
    if (!token) { location.href = "login.html"; return null; }
    return token;
  }
  function setMessage(el, text, type="") {
    if (!el) return;
    el.className = `form-message ${type}`.trim();
    el.textContent = text;
  }
  function sessionFailure(err) {
    if (/session|token|expired/i.test(err.message || "")) {
      if (isAdminPage()) Session.clearAdmin(); else Session.clearCustomer();
      location.href = "login.html";
      return true;
    }
    return false;
  }

  document.querySelectorAll("[data-menu]").forEach(btn => {
    btn.addEventListener("click", () => document.querySelector(".sidebar")?.classList.toggle("open"));
  });
  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => btn.closest("dialog")?.close());
  });
  document.querySelectorAll("[data-logout]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const token = isAdminPage() ? Session.getAdmin() : Session.getCustomer();
      try { if (token) await api("logout", {token}); } catch (_) {}
      if (isAdminPage()) Session.clearAdmin(); else Session.clearCustomer();
      location.href = "login.html";
    });
  });


  async function filePayload(file) {
    if(!file) throw new Error("Select a document.");
    const allowed=["application/pdf","image/jpeg","image/png"];
    if(!allowed.includes(file.type)) throw new Error("Only PDF, JPG and PNG documents are supported.");
    if(file.size>2*1024*1024) throw new Error("Each KYC document must be 2 MB or smaller.");
    const data=await new Promise((resolve,reject)=>{
      const r=new FileReader();r.onload=()=>resolve(String(r.result||""));r.onerror=reject;r.readAsDataURL(file);
    });
    return {file_name:file.name,mime_type:file.type,file_base64:data.split(",")[1]||""};
  }

  // CUSTOMER LOGIN
  async function initCustomerLogin() {
    const form = $("loginForm"), msg = $("message");
    if (!form) return;
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const f = new FormData(form);
      setMessage(msg, "Signing in…");
      try {
        const r = await api("loginCustomer", {
          identifier: f.get("identifier"),
          password: f.get("password")
        });
        Session.setCustomer(r.token);
        location.href = "dashboard.html";
      } catch (err) {
        setMessage(msg, err.message, "error");
      }
    });
    $("forgotPassword")?.addEventListener("click", () => {
      alert("Password reset is reserved for the next authentication hardening step.");
    });
  }

  // REGISTRATION
  async function initRegistration() {
    const form=$("registerForm"),msg=$("message");
    if(!form)return;
    let agreement=null;
    let regToken=sessionStorage.getItem("sarksh_registration_token")||"";
    let customerId=sessionStorage.getItem("sarksh_registration_customer")||"";
    let liveSessionId="";
    let pollTimer=null;

    const setQueueStatus=(title,subtitle,cls="")=>{
      const box=$("liveKycStatus");if(!box)return;
      box.className=`waiting-card ${cls}`.trim();
      box.innerHTML=`<div class="waiting-dot"></div><div><b>${esc(title)}</b><span>${esc(subtitle||"")}</span></div>`;
    };
    const unlockVerification=()=>{
      $("registrationLocked").hidden=true;
      $("registrationVerificationArea").hidden=false;
      $("registrationCustomerRef").textContent=`Customer reference: ${customerId}`;
    };
    const renderRegDocs=(docs=[])=>{
      $("registrationDocStatus").innerHTML=docs.map(d=>`<div class="document-item"><div><strong>${esc(d.document_type)}</strong><span>${esc(d.file_name||"Uploaded")} · ${esc(d.status||"RECEIVED")}</span></div><span class="status-pill success">Stored</span></div>`).join("");
    };
    async function refreshResume(){
      if(!regToken)return;
      try{
        const r=await api("registrationResumeStatus",{registration_token:regToken});
        customerId=r.customer_id;sessionStorage.setItem("sarksh_registration_customer",customerId);
        unlockVerification();renderRegDocs(r.documents||[]);
        if(r.meet?.session_id){liveSessionId=r.meet.session_id;startMeetPolling();}
        $("joinMeetKycQueue").disabled=!r.ready_for_queue || !r.kyc_desk?.accepting || Boolean(r.meet?.session_id);
        if(r.ready_for_queue && !r.meet?.session_id)setQueueStatus(r.kyc_desk?.accepting?"Documents ready":"KYC desk is sleeping",r.kyc_desk?.message||(r.kyc_desk?.accepting?"Join the KYC verification queue.":"Your documents are ready; live KYC intake is paused."),r.kyc_desk?.accepting?"":"waiting");
      }catch(_){sessionStorage.removeItem("sarksh_registration_token");sessionStorage.removeItem("sarksh_registration_customer");regToken="";}
    }
    async function pollMeet(){
      if(!regToken||!liveSessionId)return;
      try{
        const r=await api("liveKycStatus",{registration_token:regToken,session_id:liveSessionId});
        const s=r.session;
        if(s.meet_url){
          setQueueStatus("KYC agent connected","Your Google Meet is ready. Join the live verification now.","live");
          $("registrationMeetLink").href=s.meet_url;$("registrationMeetLink").hidden=false;
        }else if(s.status==="WAITING_AGENT"){
          setQueueStatus(r.desk_accepting?"Waiting for a KYC agent":"KYC queue is sleeping",r.desk_accepting?`Queue position: ${r.queue_position||1}. Keep this page open.`:(r.desk_message||"Your place is preserved; agents are not accepting KYC right now."),"waiting");
        }else if(["AGENT_JOINING","MEET_PENDING"].includes(s.status)){
          setQueueStatus("Agent accepted your request","Google Meet is being prepared…","waiting");
        }else if(s.status==="COMPLETED"){
          clearInterval(pollTimer);pollTimer=null;
          if(s.result==="VERIFIED"){
            setQueueStatus("KYC verified","Your account has been activated.","live");
            setTimeout(()=>{sessionStorage.removeItem("sarksh_registration_token");sessionStorage.removeItem("sarksh_registration_customer");location.href="login.html";},1800);
          }else{
            setQueueStatus("Verification requires attention",s.remarks||s.result,"failed");
            if(s.result==="RESUBMIT")$("joinMeetKycQueue").disabled=false;
          }
        }
      }catch(err){console.warn(err.message);}
    }
    function startMeetPolling(){if(pollTimer)clearInterval(pollTimer);pollMeet();pollTimer=setInterval(pollMeet,3000);}

    api("getRegistrationAgreement").then(r=>{
      agreement=r.agreement;$("agreementVersion").value=agreement.version||"";$("agreementHash").value=agreement.hash||"";
      $("agreementBox").textContent=agreement.text||"Agreement is not configured.";
      $("agreementState").innerHTML=`<b>${esc(agreement.title||"Registration Agreement")} · ${esc(agreement.version||"")}</b><p>${agreement.ready?"Read the full agreement before acceptance.":"Registration is disabled until the Super Admin publishes the agreement."}</p>`;
      $("beginRegistration").disabled=!agreement.ready;
    }).catch(err=>setMessage(msg,err.message,"error"));

    refreshResume();

    form.addEventListener("submit",async e=>{
      e.preventDefault();const f=new FormData(form);
      if(!agreement?.ready)return setMessage(msg,"Registration agreement is not active.","error");
      if(f.get("password")!==f.get("confirm_password"))return setMessage(msg,"Passwords do not match.","error");
      if(String(f.get("accepted_name")||"").trim().toLowerCase()!==String(f.get("full_name")||"").trim().toLowerCase())
        return setMessage(msg,"The typed agreement name must match the full legal name.","error");
      try{
        setMessage(msg,"Creating secure registration and KYC record…");
        const r=await api("registerCustomer",{
          full_name:f.get("full_name"),mobile:f.get("mobile"),email:f.get("email"),password:f.get("password"),
          pan:String(f.get("pan")||"").toUpperCase(),dob:f.get("dob"),address:f.get("address"),
          aadhaar_number:String(f.get("aadhaar_number")||""),identity_ref:f.get("identity_ref"),
          agreement_hash:f.get("agreement_hash"),agreement_version:f.get("agreement_version"),
          accepted_name:f.get("accepted_name"),agreement_consent:Boolean(f.get("agreement_consent")),user_agent:navigator.userAgent
        });
        regToken=r.registration_token;customerId=r.customer_id;
        sessionStorage.setItem("sarksh_registration_token",regToken);sessionStorage.setItem("sarksh_registration_customer",customerId);
        form.querySelectorAll("input,textarea,button").forEach(el=>el.disabled=true);
        unlockVerification();
        setMessage(msg,`Registration created. Customer reference: ${customerId}. Upload KYC documents to continue.`,"success");
      }catch(err){setMessage(msg,err.message,"error");}
    });

    $("registrationDocumentsForm")?.addEventListener("submit",async e=>{
      e.preventDefault();if(!regToken)return;
      const f=new FormData(e.currentTarget),pan=f.get("pan_document"),aad=f.get("aadhaar_document"),addr=f.get("address_document");
      try{
        setMessage($("registrationDocsMessage"),"Uploading documents securely…");
        const uploads=[["PAN_CARD",pan],["AADHAAR",aad],["ADDRESS_PROOF",addr]].filter(([,file])=>file&&file.size);
        for(const [type,file] of uploads){
          const fp=await filePayload(file);
          await api("uploadRegistrationDocument",{registration_token:regToken,document_type:type,...fp});
        }
        const r=await api("registrationResumeStatus",{registration_token:regToken});
        renderRegDocs(r.documents||[]);
        if(!r.ready_for_queue)throw new Error(r.queue_requirement||"Required KYC documents are incomplete.");
        $("joinMeetKycQueue").disabled=false;
        setQueueStatus("Documents received","You can now join the live Google Meet verification queue.");
        setMessage($("registrationDocsMessage"),"KYC documents stored successfully.","success");
      }catch(err){setMessage($("registrationDocsMessage"),err.message,"error");}
    });

    $("joinMeetKycQueue")?.addEventListener("click",async()=>{
      try{
        const r=await api("createLiveKycSession",{registration_token:regToken});
        liveSessionId=r.session_id;$("joinMeetKycQueue").disabled=true;
        setQueueStatus("Waiting for a KYC agent","Keep this page open. The Meet link will appear when an agent accepts.","waiting");
        startMeetPolling();
      }catch(err){setMessage($("registrationDocsMessage"),err.message,"error");}
    });
  }



  function drawChart(canvas, values) {
    if (!canvas || !values?.length) return;
    const ctx = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(canvas.clientWidth, 300) * ratio;
    const height = 220 * ratio;
    canvas.width = width; canvas.height = height;
    ctx.clearRect(0,0,width,height);
    const pad = 24 * ratio;
    const min = Math.min(...values), max = Math.max(...values), span = (max-min) || 1;
    ctx.lineWidth = 2 * ratio;
    ctx.strokeStyle = "#005d3b";
    ctx.beginPath();
    values.forEach((v,i) => {
      const x = pad + (width-pad*2) * (i/Math.max(1,values.length-1));
      const y = height-pad - (height-pad*2) * ((v-min)/span);
      i ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
    });
    ctx.stroke();
  }

  // CUSTOMER DASHBOARD
  async function initCustomerDashboard() {
    if (!$("currentAmount")) return;
    const token = requireCustomer(); if (!token) return;
    try {
      const r = await api("customerDashboard", {token});
      $("welcome").textContent = `Welcome, ${r.settings?.preferred_name || r.customer.full_name}`;
      if(String(r.settings?.compact_dashboard)==="TRUE") document.body.classList.add("compact-customer");
      if(String(r.settings?.show_trade_quality)==="FALSE" && $("tradeQualityPanel")) $("tradeQualityPanel").hidden=true;
      if($("customerNotifications")){const n=[];if(r.compliance?.agreement_required&&!r.compliance?.agreement_accepted)n.push(`<article class="portal-notice critical"><div><h3>Agreement signature required</h3><p>${esc(r.compliance.agreement_title)} · ${esc(r.compliance.agreement_version)} must be accepted before live KYC can proceed.</p></div><a class="btn primary" href="agreement.html">Review & Accept</a></article>`);if(r.customer.kyc_status!=="APPROVED"){const d=r.kyc_desk||{};n.push(`<article class="portal-notice ${d.accepting?"":"critical"}"><div><h3>${d.accepting?"Live KYC is available":"Live KYC desk is sleeping"}</h3><p>${esc(d.message||"Complete your KYC requirements from the KYC & Documents page.")}</p></div><a class="btn secondary" href="kyc.html">Open KYC</a></article>`);}if(!n.length)n.push(`<article class="portal-notice good"><div><h3>Account requirements are up to date</h3><p>No agreement or KYC action is currently pending.</p></div></article>`);$("customerNotifications").innerHTML=n.join("");}
      $("accountStatus").textContent = r.customer.account_status;
      if($("amountPlaced")) $("amountPlaced").textContent = money(r.metrics.amount_placed);
      $("currentAmount").textContent = money(r.metrics.current_amount);
      $("totalPnl").textContent = money(r.metrics.net_pnl);
      $("totalTrades").textContent = r.metrics.total_trades;
      $("kycStatus").textContent = r.customer.kyc_status;
      $("winningTrades").textContent = r.metrics.winning_trades;
      $("losingTrades").textContent = r.metrics.losing_trades;
      const rate = Number(r.metrics.win_rate || 0);
      $("winRate").textContent = `${rate.toFixed(1)}%`;
      $("winRing").style.background = `conic-gradient(#005d3b ${rate*3.6}deg,#e9efec 0)`;
      $("recentTrades").innerHTML = (r.recent_trades || []).map(t => `
        <tr>
          <td>${esc(t.trade_date)}</td><td><b>${esc(t.symbol)}</b></td>
          <td>${esc(t.trade_type)}</td><td>${esc(t.quantity)}</td>
          <td class="${Number(t.net_pnl)>=0?"pnl-pos":"pnl-neg"}">${money(t.net_pnl)}</td>
          <td>${esc(t.status)}</td>
        </tr>`).join("") || '<tr><td colspan="6">No trades recorded.</td></tr>';
      drawChart($("performanceChart"), r.performance || []);
    } catch (err) {
      if (!sessionFailure(err)) alert(err.message);
    }
  }

  // CUSTOMER TRADES
  async function initCustomerTrades() {
    const tbody = $("tradeRows"); if (!tbody) return;
    const token = requireCustomer(); if (!token) return;
    let rows = [];
    const render = arr => tbody.innerHTML = arr.map(t => `
      <tr><td>${esc(t.trade_date)}</td><td><b>${esc(t.symbol)}</b></td>
      <td>${esc(t.exchange)}</td><td>${esc(t.trade_type)}</td><td>${esc(t.quantity)}</td>
      <td>${money(t.entry_price)}</td><td>${t.exit_price ? money(t.exit_price) : "—"}</td>
      <td>${money(t.charges)}</td><td class="${Number(t.net_pnl)>=0?"pnl-pos":"pnl-neg"}">${money(t.net_pnl)}</td>
      <td>${esc(t.status)}</td></tr>`).join("") || '<tr><td colspan="10">No trades found.</td></tr>';
    try {
      const r = await api("customerTrades", {token});
      rows = r.trades || []; render(rows);
      $("tradeSearch")?.addEventListener("input", e => {
        const q = e.target.value.toLowerCase();
        render(rows.filter(t => String(t.symbol).toLowerCase().includes(q)));
      });
    } catch (err) { if (!sessionFailure(err)) alert(err.message); }
  }

  // CUSTOMER KYC + VIDEO
  async function initCustomerKyc() {
    const form=$("kycForm");if(!form)return;
    const token=requireCustomer();if(!token)return;
    const msg=$("message");
    const renderDocs=docs=>{
      $("customerDocuments").innerHTML=(docs||[]).map(d=>`<div class="document-item"><div><strong>${esc(d.document_type)}</strong><span>${esc(d.file_name||"Document")} · ${esc(d.status||"RECEIVED")}</span></div><span class="status-pill">${esc(d.status||"RECEIVED")}</span></div>`).join("")||'<div class="muted">No KYC documents uploaded yet.</div>';
    };
    async function load(){
      try{
        const r=await api("getKycCenter",{token});
        $("kycStatus").textContent=r.kyc?.status||"NOT SUBMITTED";
        if(r.kyc){
          form.pan.value=r.kyc.pan||"";form.dob.value=r.kyc.dob||"";form.address.value=r.kyc.address||"";form.identity_ref.value=r.kyc.identity_ref||"";
          $("aadhaarMasked").value=r.kyc.aadhaar_masked||"Not provided";
        }
        renderDocs(r.documents||[]);
        renderMeet(r.meet||null);
      }catch(err){if(!sessionFailure(err))setMessage(msg,err.message,"error");}
    }
    function renderMeet(meet){
      const pill=$("customerMeetPill"),box=$("customerMeetStatus"),link=$("joinCustomerMeet");
      if(!meet){pill.textContent="No active session";box.className="meet-status-box";box.textContent="No live KYC session is currently active.";link.hidden=true;return;}
      pill.textContent=meet.status||"KYC";box.className=`meet-status-box ${meet.meet_url?"ready":"waiting"}`;
      box.textContent=meet.meet_url?"Your Google Meet is ready. Join the KYC agent for live verification.":"Your KYC request is waiting for an authorised agent.";
      if(meet.meet_url){link.href=meet.meet_url;link.hidden=false}else link.hidden=true;
    }
    form.addEventListener("submit",async e=>{
      e.preventDefault();const f=new FormData(form);
      try{
        await api("submitKyc",{token,pan:String(f.get("pan")||"").toUpperCase(),dob:f.get("dob"),address:f.get("address"),identity_ref:f.get("identity_ref"),aadhaar_number:String(f.get("aadhaar_number")||"")});
        form.aadhaar_number.value="";setMessage(msg,"KYC information updated securely.","success");await load();
      }catch(err){setMessage(msg,err.message,"error");}
    });
    $("customerDocumentForm")?.addEventListener("submit",async e=>{
      e.preventDefault();const f=new FormData(e.currentTarget);
      try{
        const fp=await filePayload(f.get("document"));
        await api("uploadCustomerDocument",{token,document_type:f.get("document_type"),reference:f.get("reference"),...fp});
        e.currentTarget.reset();setMessage($("documentMessage"),"Document uploaded securely.","success");await load();
      }catch(err){setMessage($("documentMessage"),err.message,"error");}
    });
    $("requestMeetKyc")?.addEventListener("click",async()=>{
      try{await api("requestCustomerMeetKyc",{token});setMessage($("documentMessage"),"Live KYC request placed.","success");await load();}
      catch(err){setMessage($("documentMessage"),err.message,"error");}
    });
    load();setInterval(async()=>{try{const r=await api("customerMeetKycStatus",{token});renderMeet(r.meet||null);}catch(_){}},5000);
  }



  async function initCustomerSettings(){
    const form=$("customerSettingsForm");if(!form)return;
    const token=requireCustomer();if(!token)return;
    try{
      const r=await api("customerSettingsGet",{token}),s=r.settings||{},c=r.customer||{};
      $("settingsFullName").value=c.full_name||"";$("settingsEmail").value=c.email||"";$("settingsAccountStatus").textContent=c.account_status||"";
      form.preferred_name.value=s.preferred_name||"";form.mobile.value=c.mobile||"";form.address.value=c.address||"";
      form.email_notifications.checked=String(s.email_notifications)!=="FALSE";
      form.trade_notifications.checked=String(s.trade_notifications)==="TRUE";
      form.compact_dashboard.checked=String(s.compact_dashboard)==="TRUE";
      form.show_trade_quality.checked=String(s.show_trade_quality)!=="FALSE";
    }catch(err){if(!sessionFailure(err))setMessage($("settingsMessage"),err.message,"error");}
    form.addEventListener("submit",async e=>{
      e.preventDefault();const f=new FormData(form);
      try{
        await api("customerSettingsSave",{token,preferred_name:f.get("preferred_name"),mobile:f.get("mobile"),address:f.get("address"),
          email_notifications:Boolean(f.get("email_notifications")),trade_notifications:Boolean(f.get("trade_notifications")),
          compact_dashboard:Boolean(f.get("compact_dashboard")),show_trade_quality:Boolean(f.get("show_trade_quality"))});
        setMessage($("settingsMessage"),"Account settings saved.","success");
      }catch(err){setMessage($("settingsMessage"),err.message,"error");}
    });
    $("changePasswordForm")?.addEventListener("submit",async e=>{
      e.preventDefault();const f=new FormData(e.currentTarget);
      if(f.get("new_password")!==f.get("confirm_password"))return setMessage($("passwordMessage"),"New passwords do not match.","error");
      try{
        await api("customerChangePassword",{token,current_password:f.get("current_password"),new_password:f.get("new_password")});
        e.currentTarget.reset();setMessage($("passwordMessage"),"Password changed. Other sessions were revoked.","success");
      }catch(err){setMessage($("passwordMessage"),err.message,"error");}
    });
  }

  async function initCustomerTeam(){
    const box=$("customerTeamCards");if(!box)return;
    const token=requireCustomer();if(!token)return;
    try{
      const r=await api("customerTeam",{token});
      box.innerHTML=(r.team||[]).map(m=>`<article class="team-card"><div class="avatar">${esc(String(m.member_name||"S").slice(0,1).toUpperCase())}</div><h3>${esc(m.member_name)}</h3><p><b>${esc(m.role)}</b></p>${m.email?`<p>${esc(m.email)}</p>`:""}${m.phone?`<p>${esc(m.phone)}</p>`:""}</article>`).join("")||'<div class="alert">Your account team has not been assigned yet. SARKSH operations will update this section.</div>';
    }catch(err){if(!sessionFailure(err))box.innerHTML=`<div class="alert danger">${esc(err.message)}</div>`;}
  }

  async function initCustomerAgreement(){const form=$("customerAgreementForm");if(!form)return;const token=requireCustomer();if(!token)return;const load=async()=>{const r=await api("customerAgreementGet",{token}),a=r.agreement||{},c=r.compliance||{};$("customerAgreementTitle").textContent=a.title||"Current Agreement";$("customerAgreementMeta").textContent=`Version ${a.version||"—"} · SHA-256 ${a.hash||"—"}`;$("customerAgreementText").textContent=a.text||"No agreement is currently published.";$("customerAgreementPill").textContent=c.accepted?"ACCEPTED":(a.ready?"ACTION REQUIRED":"NOT ACTIVE");$("customerAgreementPill").className=`status-pill ${c.accepted?"success":(a.ready?"warning":"")}`;$("agreementAcceptedState").innerHTML=c.accepted?`<b>Accepted</b><p>Accepted as ${esc(c.accepted_name||"customer")} on ${esc(fmt(c.accepted_at))}.</p>`:`<b>${a.ready?"Signature required":"No active agreement"}</b><p>${a.ready?"Type your legal name and accept the current agreement.":"The Super Admin has not published an active agreement."}</p>`;form.hidden=c.accepted||!a.ready;};try{await load();}catch(err){if(!sessionFailure(err))setMessage($("customerAgreementMessage"),err.message,"error");}form.addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(form);try{await api("customerAcceptAgreement",{token,accepted_name:f.get("accepted_name"),consent:Boolean(f.get("consent")),user_agent:navigator.userAgent});setMessage($("customerAgreementMessage"),"Agreement accepted successfully.","success");await load();}catch(err){setMessage($("customerAgreementMessage"),err.message,"error");}});}

  // ADMIN LOGIN: password -> email OTP -> Google Authenticator TOTP
  async function initAdminLogin() {
    const passwordForm = $("adminPasswordForm"), otpForm = $("adminOtpForm"), totpForm = $("adminTotpForm"), msg = $("message");
    if (!passwordForm) return;
    let challengeId = null;

    function showStep(step) {
      document.querySelectorAll("[data-auth-step]").forEach(el => el.hidden = String(el.dataset.authStep) !== String(step));
      document.querySelectorAll("[data-step-dot]").forEach(el => el.classList.toggle("active", Number(el.dataset.stepDot) <= Number(step)));
      setMessage(msg, "");
    }

    passwordForm.addEventListener("submit", async e => {
      e.preventDefault();
      const f = new FormData(passwordForm);
      setMessage(msg, "Verifying password…");
      try {
        const r = await api("adminLoginStart", {email:f.get("email"), password:f.get("password")});
        challengeId = r.challenge_id;
        $("otpDestination").textContent = r.masked_email || "admin email";
        showStep(2);
        setMessage(msg, "A one-time password has been sent to the admin mailbox.", "success");
      } catch (err) { setMessage(msg, err.message, "error"); }
    });

    otpForm.addEventListener("submit", async e => {
      e.preventDefault();
      const f = new FormData(otpForm);
      setMessage(msg, "Verifying email OTP…");
      try {
        const r = await api("adminVerifyEmailOtp", {challenge_id:challengeId, otp:f.get("otp")});
        if (r.enrollment_required) {
          $("totpEnrollment").hidden = false;
          $("totpAccount").value = r.account_name || "grow@sarksh.in";
          $("totpSecret").value = r.manual_key || "";
        } else {
          $("totpEnrollment").hidden = true;
        }
        showStep(3);
        setMessage(msg, r.enrollment_required ? "Add the setup key to Google Authenticator, then enter the 6-digit code." : "Email verified. Enter your Google Authenticator code.", "success");
      } catch (err) { setMessage(msg, err.message, "error"); }
    });

    totpForm.addEventListener("submit", async e => {
      e.preventDefault();
      const f = new FormData(totpForm);
      setMessage(msg, "Verifying Authenticator code…");
      try {
        const r = await api("adminVerifyTotp", {challenge_id:challengeId, totp:f.get("totp")});
        Session.setAdmin(r.token);
        location.href = "dashboard.html";
      } catch (err) { setMessage(msg, err.message, "error"); }
    });

    $("restartAdminLogin")?.addEventListener("click", () => { challengeId=null; passwordForm.reset(); otpForm.reset(); totpForm.reset(); showStep(1); });
  }

  async function adminCall(action, payload={}) {
    const token = requireAdmin(); if (!token) throw new Error("Missing admin session");
    return api(action, {token, ...payload});
  }

  async function initAdminDashboard() {
    if (!$("totalCustomers")) return;
    try {
      const r = await adminCall("adminDashboard");
      $("totalCustomers").textContent = r.metrics.total_customers;
      $("pendingKyc").textContent = r.metrics.pending_kyc;
      $("totalTrades").textContent = r.metrics.total_trades;
      $("netPnl").textContent = money(r.metrics.net_pnl);
      if ($("adminRole")) $("adminRole").textContent = r.admin.role;
      $("alerts").innerHTML = (r.alerts || []).map(a =>
        `<div class="alert ${esc(a.level||"")}">${esc(a.message)}</div>`
      ).join("") || '<div class="alert success">No priority exceptions.</div>';
      $("auditRows").innerHTML = (r.recent_audit || []).map(a =>
        `<tr><td>${fmt(a.timestamp)}</td><td>${esc(a.actor_id)}</td><td>${esc(a.action)}</td>
        <td>${esc(a.entity_id)}</td><td>${esc(a.result)}</td></tr>`
      ).join("");
    } catch (err) { if (!sessionFailure(err)) alert(err.message); }
  }

  async function initAdminCustomers() {
    const tbody = $("customerRows"); if (!tbody) return;
    try {
      const r = await adminCall("adminCustomers");
      let rows = r.customers || [];
      const render = arr => tbody.innerHTML = arr.map(c => `
        <tr><td><b>${esc(c.customer_id)}</b></td><td>${esc(c.full_name)}</td><td>${esc(c.email)}</td>
        <td>${esc(c.kyc_status)}</td><td>${esc(c.account_status)}</td><td>${esc(c.total_trades)}</td>
        <td class="${Number(c.net_pnl)>=0?"pnl-pos":"pnl-neg"}">${money(c.net_pnl)}</td>
        <td><button class="btn secondary" data-customer="${esc(c.customer_id)}">View</button></td></tr>`
      ).join("") || '<tr><td colspan="8">No customers found.</td></tr>';
      render(rows);
      $("customerSearch")?.addEventListener("input", () => {
        const q = $("customerSearch").value.toLowerCase();
        render(rows.filter(c => JSON.stringify(c).toLowerCase().includes(q)));
      });
      tbody.addEventListener("click", e => {
        const id = e.target.dataset.customer; if (!id) return;
        location.href = `customer.html?id=${encodeURIComponent(id)}`;
      });
    } catch (err) { if (!sessionFailure(err)) alert(err.message); }
  }

  async function initCustomer360() {
    if (!$("c360Placed")) return;
    const id = new URLSearchParams(location.search).get("id");
    if (!id) { alert("Customer ID is missing."); location.href="customers.html"; return; }
    try {
      const r = await adminCall("adminCustomerDashboard", {customer_id:id});
      $("customer360Name").textContent = `${r.customer.full_name} · ${r.customer.customer_id}`;
      $("customer360Kyc").textContent = `KYC ${r.customer.kyc_status}`;
      $("customer360Account").textContent = r.customer.account_status;
      $("c360Placed").textContent = money(r.metrics.amount_placed);
      $("c360Current").textContent = money(r.metrics.current_amount);
      $("c360Trades").textContent = r.metrics.total_trades;
      $("c360Pnl").textContent = money(r.metrics.net_pnl);
      $("c360Profile").innerHTML = Object.entries(r.customer).filter(([k])=>!["__row","pan_ref"].includes(k)).map(([k,v]) =>
        `<div class="detail-item"><small>${esc(k.replaceAll("_"," "))}</small><b>${esc(v||"—")}</b></div>`).join("");
      $("c360TradeRows").innerHTML = (r.trades||[]).map(t=>`<tr><td>${esc(t.trade_date)}</td><td><b>${esc(t.symbol)}</b></td><td>${esc(t.trade_type)}</td><td>${esc(t.quantity)}</td><td>${money(t.entry_price)}</td><td>${t.exit_price?money(t.exit_price):"—"}</td><td>${money(t.charges)}</td><td class="${Number(t.net_pnl)>=0?"pnl-pos":"pnl-neg"}">${money(t.net_pnl)}</td><td>${esc(t.status)}</td></tr>`).join("") || '<tr><td colspan="9">No trades recorded.</td></tr>';
      $("c360LedgerRows").innerHTML = (r.ledger||[]).map(l=>`<tr><td>${esc(l.date)}</td><td>${esc(l.type)}</td><td>${money(l.amount)}</td><td class="${Number(l.signed_amount)>=0?"pnl-pos":"pnl-neg"}">${money(l.signed_amount)}</td><td>${esc(l.reference)}</td><td>${esc(l.description)}</td></tr>`).join("") || '<tr><td colspan="6">No ledger entries recorded.</td></tr>';
    } catch(err) { if(!sessionFailure(err)) alert(err.message); }
  }

  async function initAdminKyc(){const tbody=$("kycRows");if(!tbody)return;tbody.innerHTML='<tr class="table-loading"><td colspan="6"><div class="loading-line"></div></td></tr>';try{const r=await adminCall("adminKycQueue"),rows=r.items||[];$("pendingCount").textContent=`${rows.filter(x=>["PENDING","WAITING_AGENT","MEET_READY","LIVE"].includes(String(x.status))).length} pending`;tbody.innerHTML=rows.map(k=>`<tr><td>${fmt(k.submitted_at)}</td><td>${esc(k.customer_id)} · ${esc(k.full_name)}</td><td>${esc(k.pan_masked||"—")}</td><td>${esc(k.live_kyc_status||"Not started")}</td><td>${esc(k.status)}</td><td><button class="btn secondary" data-kyc="${esc(k.customer_id)}">Review</button></td></tr>`).join("")||'<tr><td colspan="6">No KYC records.</td></tr>';tbody.addEventListener("click",e=>{const id=e.target.dataset.kyc;if(!id)return;const k=rows.find(x=>x.customer_id===id);$("kycDetail").innerHTML=`<p class="eyebrow">KYC REVIEW</p><h2>${esc(k.full_name)} · ${esc(k.customer_id)}</h2><div class="detail-grid">${["pan_masked","aadhaar_masked","dob","address","identity_ref","status","live_kyc_status","submitted_at"].map(x=>`<div class="detail-item"><small>${esc(x.replaceAll("_"," "))}</small><b>${esc(k[x]||"—")}</b></div>`).join("")}</div><label>Reviewer remarks<textarea id="kycRemarks" rows="3"></textarea></label><div class="button-row"><button class="btn primary" data-review="APPROVED">Approve</button><button class="btn secondary" data-review="RESUBMIT">Request Resubmission</button><button class="btn ghost" data-review="REJECTED">Reject</button></div>`;$("kycDialog").showModal();$("kycDetail").onclick=async ev=>{const status=ev.target.dataset.review;if(!status)return;try{await adminCall("reviewKyc",{customer_id:id,status,remarks:$("kycRemarks").value});location.reload();}catch(err){alert(err.message);}};});}catch(err){if(!sessionFailure(err)){$("pendingCount").textContent="Error";tbody.innerHTML=`<tr class="table-error"><td colspan="6">Could not load KYC records: ${esc(err.message)} <button class="btn ghost" onclick="location.reload()">Retry</button></td></tr>`;}}}


  async function initAdminTrades(){const form=$("tradeForm"),tbody=$("adminTradeRows");if(!form||!tbody)return;const refresh=async()=>{tbody.innerHTML='<tr class="table-loading"><td colspan="7"><div class="loading-line"></div></td></tr>';try{const r=await adminCall("adminTrades"),rows=r.trades||[];tbody.innerHTML=rows.map(t=>`<tr><td>${esc(t.trade_id)}</td><td>${esc(t.customer_id)}</td><td>${esc(t.trade_date)}</td><td><b>${esc(t.symbol)}</b></td><td>${esc(t.quantity)}</td><td class="${Number(t.net_pnl)>=0?"pnl-pos":"pnl-neg"}">${money(t.net_pnl)}</td><td>${esc(t.status)}</td></tr>`).join("")||'<tr><td colspan="7">No trades recorded.</td></tr>';}catch(err){if(!sessionFailure(err))tbody.innerHTML=`<tr class="table-error"><td colspan="7">Could not load trades: ${esc(err.message)} <button class="btn ghost" onclick="location.reload()">Retry</button></td></tr>`;throw err;}};try{await refresh();}catch(_){}const calc=()=>{const f=new FormData(form),q=+f.get("quantity")||0,en=+f.get("entry_price")||0,ex=+f.get("exit_price")||0,ch=+f.get("charges")||0,type=f.get("trade_type");let pnl=(type==="SELL"?(en-ex):(ex-en))*q-ch;if(f.get("status")!=="CLOSED")pnl=0;$("previewPnl").textContent=money(pnl);};form.addEventListener("input",calc);form.addEventListener("submit",async e=>{e.preventDefault();try{await adminCall("adminCreateTrade",Object.fromEntries(new FormData(form)));setMessage($("message"),"Trade saved and metrics recalculated.","success");form.reset();calc();await refresh();}catch(err){setMessage($("message"),err.message,"error");}});}


  async function initAdminMonitoring() {
    if (!$("healthCards")) return;
    try {
      const r=await adminCall("adminMonitoring"),m=r.metrics;
      $("regToday").textContent=m.registrations_today??0;
      $("loginSuccess").textContent=m.successful_logins??0;
      $("loginFailed").textContent=m.failed_logins??0;
      $("tradesToday").textContent=m.trades_today??0;
      $("healthCards").innerHTML=(r.health||[]).map(h=>`
        <div class="health-card"><b>${esc(h.name)}</b>
        <span class="status-pill ${h.status==="ONLINE"?"success":"danger"}">${esc(h.status)}</span>
        <p class="muted">${esc(h.detail||"")}</p></div>`).join("");
      $("monitorAlerts").innerHTML=(r.alerts||[]).map(a=>`<div class="alert ${esc(a.level||"")}">${esc(a.message)}</div>`).join("")
        ||'<div class="alert success">No exceptions detected.</div>';
    } catch(err){if(!sessionFailure(err)) alert(err.message);}
  }

  async function initAudit() {
    const tbody=$("auditTableRows"); if(!tbody) return;
    try{
      const r=await adminCall("adminAudit"), rows=r.logs||[];
      const render=arr=>tbody.innerHTML=arr.map(a=>`<tr><td>${fmt(a.timestamp)}</td><td>${esc(a.actor_id)}</td>
        <td>${esc(a.actor_role)}</td><td>${esc(a.action)}</td><td>${esc(a.entity_type)} · ${esc(a.entity_id)}</td>
        <td>${esc(a.result)}</td></tr>`).join("");
      render(rows);
      $("auditSearch")?.addEventListener("input",()=> {
        const q=$("auditSearch").value.toLowerCase();
        render(rows.filter(a=>JSON.stringify(a).toLowerCase().includes(q)));
      });
    }catch(err){if(!sessionFailure(err)) alert(err.message);}
  }

  async function initAccounts() {
    const tbody=$("accountRows"); if(!tbody) return;
    try {
      const r=await adminCall("adminAccounts");
      let rows=r.accounts||[];
      const render=arr=>tbody.innerHTML=arr.map(c=>`<tr><td><b>${esc(c.customer_id)}</b></td><td>${esc(c.full_name)}</td>
        <td>${esc(c.account_status)}</td><td>${money(c.current_amount)}</td>
        <td class="${Number(c.net_pnl)>=0?"pnl-pos":"pnl-neg"}">${money(c.net_pnl)}</td><td>${esc(c.total_trades)}</td></tr>`).join("")
        ||'<tr><td colspan="6">No accounts found.</td></tr>';
      render(rows);
      $("accountSearch")?.addEventListener("input",()=>{
        const q=$("accountSearch").value.toLowerCase();
        render(rows.filter(c=>JSON.stringify(c).toLowerCase().includes(q)));
      });
      $("ledgerForm")?.addEventListener("submit",async e=>{
        e.preventDefault();
        try{
          const x=await adminCall("adminLedgerEntry",Object.fromEntries(new FormData($("ledgerForm"))));
          setMessage($("ledgerMessage"),`Ledger entry posted. Current amount: ${money(x.current_amount)}`,"success");
          setTimeout(()=>location.reload(),600);
        }catch(err){setMessage($("ledgerMessage"),err.message,"error");}
      });
    } catch(err){if(!sessionFailure(err)) alert(err.message);}
  }

  function csvDownload(name, rows) {
    if (!rows.length) throw new Error("No records to export.");
    const cols=Object.keys(rows[0]).filter(k=>k!=="__row");
    const q=v=>`"${String(v??"").replaceAll('"','""')}"`;
    const csv=[cols.map(q).join(","),...rows.map(r=>cols.map(c=>q(r[c])).join(","))].join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=`SARKSH_${name}_${new Date().toISOString().slice(0,10)}.csv`;a.click();
    URL.revokeObjectURL(url);
  }
  function initReports() {
    if(!document.querySelector("[data-report]")) return;
    document.querySelectorAll("[data-report]").forEach(btn=>btn.addEventListener("click",async()=>{
      const m=$("reportMessage");
      try{
        setMessage(m,"Preparing report…");
        let rows=[],name=btn.dataset.report;
        if(name==="customers") rows=(await adminCall("adminCustomers")).customers||[];
        if(name==="trades") rows=(await adminCall("adminTrades")).trades||[];
        if(name==="audit") rows=(await adminCall("adminAudit")).logs||[];
        csvDownload(name,rows);setMessage(m,"CSV generated.","success");
      }catch(err){setMessage(m,err.message,"error");}
    }));
  }

  async function initAdmins() {
    const tbody=$("adminRows"); if(!tbody) return;
    const load=async()=>{
      const r=await adminCall("adminListAdmins");
      tbody.innerHTML=(r.admins||[]).map(a=>`<tr><td>${esc(a.admin_id)}</td><td>${esc(a.name)}</td>
      <td>${esc(a.email)}</td><td>${esc(a.role)}</td><td>${esc(a.status)}</td><td>${fmt(a.last_login)}</td>
      <td>${a.status==="ACTIVE"
        ?`<button class="btn ghost" data-admin-id="${esc(a.admin_id)}" data-admin-status="DISABLED">Disable</button>`
        :`<button class="btn secondary" data-admin-id="${esc(a.admin_id)}" data-admin-status="ACTIVE">Enable</button>`}</td></tr>`).join("");
    };
    try{await load();}catch(err){if(!sessionFailure(err))alert(err.message);return;}
    tbody.addEventListener("click",async e=>{
      if(!e.target.dataset.adminId)return;
      try{await adminCall("adminSetAdminStatus",{admin_id:e.target.dataset.adminId,status:e.target.dataset.adminStatus});await load();}
      catch(err){alert(err.message);}
    });
    $("adminCreateForm")?.addEventListener("submit",async e=>{
      e.preventDefault();
      try{
        await adminCall("adminCreateAdmin",Object.fromEntries(new FormData($("adminCreateForm"))));
        setMessage($("adminCreateMessage"),"Administrator created.","success");
        $("adminCreateForm").reset();await load();
      }catch(err){setMessage($("adminCreateMessage"),err.message,"error");}
    });
  }


  async function initAgreementAdmin() {
    const form=$("agreementAdminForm");
    if(!form) return;
    try{
      const r=await adminCall("adminAgreementGet");
      const a=r.agreement||{};
      form.title.value=a.title||"";
      form.version.value=a.version||"";
      form.text.value=a.text||"";
      form.ready.checked=Boolean(a.ready);
      const pill=$("agreementReadyPill");
      pill.textContent=a.ready?"ACTIVE":"NOT ACTIVE";
      pill.className=`status-pill ${a.ready?"success":"warning"}`;
    }catch(err){if(!sessionFailure(err))setMessage($("agreementAdminMessage"),err.message,"error");}

    form.addEventListener("submit",async e=>{
      e.preventDefault();
      const f=new FormData(form);
      try{
        const r=await adminCall("adminAgreementSave",{
          title:f.get("title"),version:f.get("version"),text:f.get("text"),
          ready:Boolean(f.get("ready"))
        });
        setMessage($("agreementAdminMessage"),`Agreement saved. SHA-256: ${r.hash}`,"success");
        const pill=$("agreementReadyPill");
        pill.textContent=r.ready?"ACTIVE":"NOT ACTIVE";
        pill.className=`status-pill ${r.ready?"success":"warning"}`;
      }catch(err){setMessage($("agreementAdminMessage"),err.message,"error");}
    });
  }


  async function initAdminLiveKyc() {
    const queue=$("liveKycQueue");if(!queue)return;let activeSessionId="",deskAccepting=false;
    const setStatus=(t,cls="")=>{$("agentCallStatus").textContent=t;$("agentCallStatus").className=`status-pill ${cls}`.trim();};
    const renderDocs=docs=>{$("agentKycDocuments").innerHTML=(docs||[]).map(d=>`<div class="document-item"><div><strong>${esc(d.document_type)}</strong><span>${esc(d.file_name||"Document")} · ${esc(d.status||"RECEIVED")}</span></div>${d.file_url?`<a class="btn ghost" href="${esc(d.file_url)}" target="_blank" rel="noopener">Open</a>`:""}</div>`).join("")||'<div class="muted">No documents uploaded.</div>';};
    async function loadDesk(){const r=await adminCall("adminKycAvailabilityGet");deskAccepting=Boolean(r.accepting);$("kycDeskState").textContent=deskAccepting?"ACTIVE":"SLEEPING";$("kycDeskState").className=`status-pill ${deskAccepting?"active-desk":"sleeping"}`;$("kycDeskToggle").disabled=false;$("kycDeskToggle").textContent=deskAccepting?"Pause KYC Queue":"Start KYC Queue";$("kycDeskToggle").className=`btn ${deskAccepting?"ghost":"primary"}`;$("kycDeskMessage").value=r.message||"";return r;}
    async function loadQueue(){try{const r=await adminCall("agentLiveKycQueue"),items=r.sessions||[];deskAccepting=Boolean(r.accepting);$("liveQueuePill").textContent=deskAccepting?`${items.filter(x=>x.status==="WAITING_AGENT").length} waiting`:"Sleeping";$("liveQueuePill").className=`status-pill ${deskAccepting?"warning":"sleeping"}`;queue.innerHTML=items.map(x=>`<div class="live-queue-item ${x.status==="WAITING_AGENT"?"waiting":"mine"}"><h3>${esc(x.full_name)} · ${esc(x.customer_id)}</h3><div class="live-queue-meta"><span>${esc(x.status)}</span><span>${esc(x.email)}</span><span>${esc(x.pan_masked||"")}</span><span>${esc(x.aadhaar_masked||"")}</span><span>${esc(x.wait_minutes)} min</span></div><button class="btn ${deskAccepting?"primary":"ghost"}" data-live-session="${esc(x.session_id)}" ${deskAccepting?"":"disabled"}>${deskAccepting?"Open KYC Workspace":"Queue Sleeping"}</button></div>`).join("")||`<div class="alert ${deskAccepting?"success":""}">${deskAccepting?"No customers are waiting.":"KYC intake is sleeping. Existing waiting records are preserved."}</div>`;}catch(err){if(!sessionFailure(err))queue.innerHTML=`<div class="alert danger">${esc(err.message)}</div>`;}}
    $("kycDeskToggle")?.addEventListener("click",async()=>{try{const r=await adminCall("adminKycAvailabilitySet",{accepting:!deskAccepting,message:$("kycDeskMessage").value});deskAccepting=Boolean(r.accepting);await loadDesk();await loadQueue();setMessage($("kycDeskMessageResult"),deskAccepting?"KYC queue is active.":"KYC queue is sleeping; new requests and agent accepts are blocked.","success");}catch(err){setMessage($("kycDeskMessageResult"),err.message,"error");}});
    $("kycDeskMessage")?.addEventListener("change",async()=>{try{await adminCall("adminKycAvailabilitySet",{accepting:deskAccepting,message:$("kycDeskMessage").value});setMessage($("kycDeskMessageResult"),"Status message saved.","success");}catch(err){setMessage($("kycDeskMessageResult"),err.message,"error");}});

    queue.addEventListener("click",async e=>{
      const id=e.target.dataset.liveSession;if(!id||!deskAccepting)return;
      try{
        const r=await adminCall("agentAcceptLiveKyc",{session_id:id});activeSessionId=id;
        $("agentCallTitle").textContent=`${r.customer.full_name} · ${r.customer.customer_id}`;
        $("agentCustomerSummary").innerHTML=[["Email",r.customer.email],["Mobile",r.customer.mobile],["PAN",r.customer.pan_masked],["Aadhaar",r.customer.aadhaar_masked],["DOB",r.customer.dob],["Address",r.customer.address],["Agreement",r.customer.agreement_version]].map(([k,v])=>`<div class="detail-item"><small>${esc(k)}</small><b>${esc(v||"—")}</b></div>`).join("");
        renderDocs(r.documents||[]);setStatus(r.meet_url?"Meet ready":"Customer selected",r.meet_url?"success":"warning");
        $("agentMeetUrl").value=r.meet_url||"";
        $("publishAgentMeet").disabled=!deskAccepting;
        if(r.meet_url){$("joinAgentMeet").href=r.meet_url;$("joinAgentMeet").hidden=false;["markVerified","markResubmit","markRejected"].forEach(x=>$(x).disabled=false);}
        else{$("joinAgentMeet").hidden=true;["markVerified","markResubmit","markRejected"].forEach(x=>$(x).disabled=true);}
        await loadQueue();
      }catch(err){setMessage($("agentLiveMessage"),err.message,"error");}
    });

    $("publishAgentMeet")?.addEventListener("click",async()=>{
      if(!activeSessionId||!deskAccepting)return;
      const meetUrl=String($("agentMeetUrl").value||"").trim();
      try{
        setMessage($("agentLiveMessage"),"Publishing Google Meet link to customer…");
        const r=await adminCall("agentPublishMeetKyc",{session_id:activeSessionId,meet_url:meetUrl});
        $("joinAgentMeet").href=r.meet_url;$("joinAgentMeet").hidden=false;
        ["markVerified","markResubmit","markRejected"].forEach(x=>$(x).disabled=false);
        setStatus("Meet ready","success");
        setMessage($("agentLiveMessage"),"Meet link published. The customer portal is now showing the same link.","success");
      }catch(err){setMessage($("agentLiveMessage"),err.message,"error");}
    });

    async function finish(result){if(!activeSessionId)return;const remarks=$("liveKycRemarks").value||"";if(result!=="VERIFIED"&&!remarks)return setMessage($("agentLiveMessage"),"Enter remarks first.","error");try{await adminCall("agentCompleteLiveKyc",{session_id:activeSessionId,result,remarks});setMessage($("agentLiveMessage"),result==="VERIFIED"?"Customer verified and activated.":`KYC result: ${result}.`,result==="VERIFIED"?"success":"error");activeSessionId="";$("liveKycRemarks").value="";$("joinAgentMeet").hidden=true;$("agentMeetUrl").value="";$("publishAgentMeet").disabled=true;["markVerified","markResubmit","markRejected"].forEach(x=>$(x).disabled=true);setStatus("Completed","success");await loadQueue();}catch(err){setMessage($("agentLiveMessage"),err.message,"error");}}
    $("markVerified")?.addEventListener("click",()=>finish("VERIFIED"));$("markResubmit")?.addEventListener("click",()=>finish("RESUBMIT"));$("markRejected")?.addEventListener("click",()=>finish("REJECTED"));$("refreshLiveQueue")?.addEventListener("click",loadQueue);
    try{await loadDesk();await loadQueue();}catch(err){setMessage($("kycDeskMessageResult"),err.message,"error");}
    setInterval(loadQueue,10000);
  }





  function initAdminCustomerTeamAssignment(){
    const form=$("assignCustomerTeamForm");if(!form)return;
    const id=new URLSearchParams(location.search).get("id");if(!id)return;
    form.addEventListener("submit",async e=>{
      e.preventDefault();const f=new FormData(form);
      try{
        await adminCall("adminAssignCustomerTeam",{customer_id:id,member_name:f.get("member_name"),role:f.get("role"),email:f.get("email"),phone:f.get("phone")});
        setMessage($("assignTeamMessage"),"Team member assigned. Reloading customer view…","success");setTimeout(()=>location.reload(),600);
      }catch(err){setMessage($("assignTeamMessage"),err.message,"error");}
    });
  }

  async function boot() {
    await initCustomerLogin();
    await initRegistration();
    await initCustomerDashboard();
    await initCustomerTrades();
    await initCustomerKyc();
    await initAdminLogin();
    await initAdminDashboard();
    await initAdminCustomers();
    await initCustomer360();
    await initAdminKyc();
    await initAdminTrades();
    await initAdminMonitoring();
    await initAudit();
    await initAccounts();
    initReports();
    await initAdmins();
    await initAgreementAdmin();
    await initAdminLiveKyc();
    await initCustomerSettings();
    await initCustomerTeam();
    await initCustomerAgreement();
    initAdminCustomerTeamAssignment();
  }

  boot().catch(err => {
    console.error("SARKSH bootstrap error:", err);
    if (!sessionFailure(err)) {
      const target = $("message") || $("ledgerMessage") || $("reportMessage");
      if (target) setMessage(target, err.message, "error");
    }
  });
})();
