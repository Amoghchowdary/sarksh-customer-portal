
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
    BUILD: "5.0.0"
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
    if (!CONFIG.BACKEND_URL || CONFIG.BACKEND_URL.includes("PASTE_")) {
      throw new Error("Backend URL is not configured. Edit js/app.js.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(CONFIG.BACKEND_URL, {
        method: "POST",
        headers: {"Content-Type":"text/plain;charset=utf-8"},
        body: JSON.stringify({
          action,
          request_id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          client_build: CONFIG.BUILD,
          ...payload
        }),
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Backend HTTP ${response.status}`);
      const data = await response.json();
      if (!data || data.ok !== true) throw new Error(data?.error || "Backend request failed.");
      return data;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("Backend request timed out.");
      throw err;
    } finally {
      clearTimeout(timeout);
    }
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
    const form = $("registerForm"), msg = $("message");
    if (!form) return;

    let registrationToken = "";
    let agreement = null;
    let localStream = null;
    let peer = null;
    let liveSessionId = "";
    let statusTimer = null;
    let signalTimer = null;
    let lastSignalSeq = 0;
    let customerOfferSent = false;
    let pendingIce = [];

    const statusCard = $("liveKycStatus");
    const setLiveStatus = (title, subtitle, cls="") => {
      if(!statusCard) return;
      statusCard.className = `waiting-card ${cls}`.trim();
      statusCard.innerHTML = `<div class="waiting-dot"></div><div><b>${esc(title)}</b><span>${esc(subtitle||"")}</span></div>`;
    };

    const stopTimers = () => {
      if(statusTimer) clearInterval(statusTimer);
      if(signalTimer) clearInterval(signalTimer);
      statusTimer = signalTimer = null;
    };
    const closeMedia = () => {
      stopTimers();
      try{peer?.close();}catch(_){}
      peer = null;
      localStream?.getTracks().forEach(t=>t.stop());
      localStream = null;
      if($("customerLocalVideo")) $("customerLocalVideo").srcObject = null;
      if($("customerRemoteVideo")) $("customerRemoteVideo").srcObject = null;
      $("leaveLiveKyc").disabled = true;
    };

    async function sendCustomerSignal(type,payload) {
      return api("liveKycSignalSend",{
        registration_token:registrationToken,
        session_id:liveSessionId,
        participant:"CUSTOMER",
        type,
        payload_json:JSON.stringify(payload)
      });
    }

    async function flushCustomerIce() {
      if(!peer?.remoteDescription) return;
      const items=[...pendingIce]; pendingIce=[];
      for(const c of items){try{await peer.addIceCandidate(c);}catch(_){}}
    }

    async function startCustomerPeer() {
      if(customerOfferSent || !localStream || !liveSessionId) return;
      customerOfferSent = true;
      peer = new RTCPeerConnection(RTC_CONFIG);
      localStream.getTracks().forEach(t=>peer.addTrack(t,localStream));
      peer.ontrack = ev => {
        const stream=ev.streams?.[0];
        if(stream) $("customerRemoteVideo").srcObject=stream;
      };
      peer.onicecandidate = ev => {
        if(ev.candidate) sendCustomerSignal("ICE",ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate).catch(()=>{});
      };
      peer.onconnectionstatechange = () => {
        const s=peer.connectionState;
        if(s==="connected") {
          setLiveStatus("Live with verification agent","The agent can now complete your verification.","live");
          setMessage($("videoMessage"),"Secure peer-to-peer live connection established.","success");
        } else if(["failed","disconnected"].includes(s)) {
          setLiveStatus("Connection interrupted","Keep this page open while the call reconnects.","waiting");
        }
      };
      const offer=await peer.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:true});
      await peer.setLocalDescription(offer);
      await sendCustomerSignal("OFFER",{type:offer.type,sdp:offer.sdp});
    }

    async function pollCustomerSignals() {
      if(!liveSessionId) return;
      try{
        const r=await api("liveKycSignalPoll",{
          registration_token:registrationToken,
          session_id:liveSessionId,
          participant:"CUSTOMER",
          after_seq:lastSignalSeq
        });
        for(const s of (r.signals||[])){
          lastSignalSeq=Math.max(lastSignalSeq,Number(s.seq||0));
          const payload=JSON.parse(s.payload_json||"{}");
          if(s.type==="ANSWER" && peer && !peer.remoteDescription){
            await peer.setRemoteDescription(payload);
            await flushCustomerIce();
          } else if(s.type==="ICE"){
            const cand=new RTCIceCandidate(payload);
            if(peer?.remoteDescription) { try{await peer.addIceCandidate(cand);}catch(_){} }
            else pendingIce.push(cand);
          }
        }
      }catch(err){
        console.warn("KYC signal poll:",err.message);
      }
    }

    async function pollLiveStatus() {
      if(!liveSessionId) return;
      try{
        const r=await api("liveKycStatus",{registration_token:registrationToken,session_id:liveSessionId});
        const s=r.session;
        if(s.status==="WAITING_AGENT"){
          setLiveStatus("Waiting for a SARKSH verification agent",`Queue position: ${r.queue_position || 1}. Keep this page open.`,"waiting");
        } else if(s.status==="AGENT_JOINING"){
          setLiveStatus("Agent accepted your verification","Connecting the secure live call…","waiting");
          await startCustomerPeer();
        } else if(s.status==="LIVE"){
          setLiveStatus("Live verification in progress","Stay on camera until the agent completes the verification.","live");
          await startCustomerPeer();
        } else if(s.status==="COMPLETED"){
          stopTimers();
          const result=String(s.result||"");
          if(result==="VERIFIED"){
            setLiveStatus("Verification approved","Your account is now active.","live");
            setMessage($("videoMessage"),"Live KYC verified. Redirecting to login…","success");
            setTimeout(()=>location.href="login.html",1800);
          } else if(result==="RESUBMIT"){
            setLiveStatus("Re-verification requested","The agent requested another live verification session.","waiting");
            setMessage($("videoMessage"),s.remarks||"Please rejoin the verification queue.","error");
            $("joinLiveKyc").textContent="Rejoin Verification Queue";
            $("joinLiveKyc").disabled=false;
            liveSessionId="";
            customerOfferSent=false;
            try{peer?.close();}catch(_){}
            peer=null;
          } else {
            setLiveStatus("Verification not approved",s.remarks||"Please contact SARKSH support.","failed");
            setMessage($("videoMessage"),s.remarks||"Verification was not approved.","error");
          }
        }
      }catch(err){
        if(/expired/i.test(err.message)){
          closeMedia();
          setLiveStatus("Verification session expired","Restart registration to continue.","failed");
        }
      }
    }

    try {
      api("getRegistrationAgreement").then(r=>{
        agreement=r.agreement;
        $("agreementVersion").value=agreement.version||"";
        $("agreementHash").value=agreement.hash||"";
        $("agreementBox").textContent=agreement.text||"Agreement is not configured.";
        $("agreementState").innerHTML=`<b>${esc(agreement.title||"Registration Agreement")} · ${esc(agreement.version||"")}</b>
          <p>${agreement.ready?"Read the complete agreement below before accepting.":"The agreement is not active yet. Registration is disabled until the Super Admin publishes it."}</p>`;
        if(!agreement.ready)$("agreementBox").classList.add("not-ready");
        $("beginRegistration").disabled=!agreement.ready;
      }).catch(err=>{
        $("agreementBox").textContent="Unable to load the agreement.";
        $("agreementBox").classList.add("not-ready");
        setMessage(msg,err.message,"error");
      });
    } catch(_) {}

    form.addEventListener("submit",async e=>{
      e.preventDefault();
      if(!agreement?.ready)return setMessage(msg,"Registration agreement is not active yet.","error");
      const f=new FormData(form);
      if(f.get("password")!==f.get("confirm_password"))return setMessage(msg,"Passwords do not match.","error");
      if(String(f.get("accepted_name")||"").trim().toLowerCase()!==String(f.get("full_name")||"").trim().toLowerCase())
        return setMessage(msg,"The typed agreement name must match the full legal name.","error");

      setMessage(msg,"Securing account, KYC and agreement acceptance…");
      try{
        const r=await api("registerCustomer",{
          full_name:f.get("full_name"),mobile:f.get("mobile"),email:f.get("email"),
          password:f.get("password"),pan:String(f.get("pan")||"").toUpperCase(),
          dob:f.get("dob"),address:f.get("address"),identity_ref:f.get("identity_ref"),
          agreement_hash:f.get("agreement_hash"),agreement_version:f.get("agreement_version"),
          accepted_name:f.get("accepted_name"),agreement_consent:Boolean(f.get("agreement_consent")),
          user_agent:navigator.userAgent
        });
        registrationToken=r.registration_token;
        form.querySelectorAll("input,textarea,button").forEach(el=>el.disabled=true);
        $("liveKycPanel").classList.add("unlocked");
        $("joinLiveKyc").disabled=false;
        setLiveStatus("Ready for live verification","Start your camera and join the verification queue.");
        setMessage(msg,`Registration secured. Customer reference: ${r.customer_id}. Complete live agent verification to activate the account.`,"success");
      }catch(err){setMessage(msg,err.message,"error");}
    });

    $("joinLiveKyc")?.addEventListener("click",async()=>{
      if(!registrationToken)return;
      try{
        if(!localStream){
          localStream=await navigator.mediaDevices.getUserMedia({
            video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:15,max:24}},
            audio:{echoCancellation:true,noiseSuppression:true}
          });
          $("customerLocalVideo").srcObject=localStream;
        }
        const r=await api("createLiveKycSession",{registration_token:registrationToken});
        liveSessionId=r.session_id;
        lastSignalSeq=0;customerOfferSent=false;pendingIce=[];
        $("joinLiveKyc").disabled=true;
        $("leaveLiveKyc").disabled=false;
        setLiveStatus("Waiting for a SARKSH verification agent","Keep this tab open. An authorised agent will connect shortly.","waiting");
        await pollLiveStatus();
        statusTimer=setInterval(pollLiveStatus,3000);
        signalTimer=setInterval(pollCustomerSignals,1500);
      }catch(err){setMessage($("videoMessage"),err.message,"error");}
    });

    $("leaveLiveKyc")?.addEventListener("click",()=>{
      closeMedia();
      setLiveStatus("You left the live call","Reload the page if you need to restart verification.","failed");
    });

    window.addEventListener("beforeunload",()=>closeMedia());
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
      $("welcome").textContent = `Welcome, ${r.customer.full_name}`;
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
    const form = $("kycForm"); if (!form) return;
    const token = requireCustomer(); if (!token) return;
    const msg = $("message"), videoMsg = $("videoMessage");
    let stream = null, recorder = null, chunks = [];
    try {
      const r = await api("getKyc", {token});
      $("kycStatus").textContent = r.kyc?.status || "NOT SUBMITTED";
      if (r.kyc) {
        form.pan.value = r.kyc.pan || "";
        form.dob.value = r.kyc.dob || "";
        form.address.value = r.kyc.address || "";
        form.identity_ref.value = r.kyc.identity_ref || "";
      }
    } catch (err) { if (!sessionFailure(err)) setMessage(msg, err.message, "error"); }

    form.addEventListener("submit", async e => {
      e.preventDefault();
      const f = new FormData(form);
      setMessage(msg, "Submitting…");
      try {
        await api("submitKyc", {
          token,
          pan: String(f.get("pan") || "").toUpperCase(),
          dob: f.get("dob"),
          address: f.get("address"),
          identity_ref: f.get("identity_ref")
        });
        $("kycStatus").textContent = "PENDING";
        setMessage(msg, "KYC details submitted for review.", "success");
      } catch (err) { setMessage(msg, err.message, "error"); }
    });

    $("startCamera")?.addEventListener("click", async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({video:true,audio:true});
        $("preview").srcObject = stream;
        $("recordVideo").disabled = false;
        setMessage(videoMsg, "Camera ready.", "success");
      } catch (_) {
        setMessage(videoMsg, "Camera/microphone permission is required.", "error");
      }
    });

    $("recordVideo")?.addEventListener("click", () => {
      if (!stream) return;
      chunks = [];
      const opts = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? {mimeType:"video/webm;codecs=vp8,opus"} : {};
      recorder = new MediaRecorder(stream, opts);
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, {type:recorder.mimeType || "video/webm"});
        const mb = blob.size/1024/1024;
        if (mb > CONFIG.VIDEO_MAX_MB) {
          return setMessage(videoMsg, `Video is ${mb.toFixed(1)} MB; MVP limit is ${CONFIG.VIDEO_MAX_MB} MB.`, "error");
        }
        setMessage(videoMsg, "Uploading verification clip…");
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64 = String(reader.result).split(",")[1];
            await api("uploadKycVideo", {token, mime_type:blob.type, file_base64:base64});
            setMessage(videoMsg, "Verification clip uploaded for admin review.", "success");
          } catch (err) { setMessage(videoMsg, err.message, "error"); }
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      setMessage(videoMsg, "Recording for 15 seconds…");
      setTimeout(() => recorder?.state === "recording" && recorder.stop(), 15000);
    });
  }

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

  async function initAdminKyc() {
    const tbody = $("kycRows"); if (!tbody) return;
    try {
      const r = await adminCall("adminKycQueue");
      let rows = r.items || [];
      $("pendingCount").textContent = `${rows.filter(x=>x.status==="PENDING").length} pending`;
      tbody.innerHTML = rows.map(k => `
        <tr><td>${fmt(k.submitted_at)}</td><td>${esc(k.customer_id)} · ${esc(k.full_name)}</td>
        <td>${esc(k.pan||"—")}</td><td>${k.video_file_id?"Uploaded":"—"}</td><td>${esc(k.status)}</td>
        <td><button class="btn secondary" data-kyc="${esc(k.customer_id)}">Review</button></td></tr>`
      ).join("") || '<tr><td colspan="6">No KYC submissions.</td></tr>';
      tbody.addEventListener("click", e => {
        const id=e.target.dataset.kyc; if(!id) return;
        const k=rows.find(x=>x.customer_id===id);
        $("kycDetail").innerHTML = `
          <p class="eyebrow">KYC REVIEW</p><h2>${esc(k.full_name)} · ${esc(k.customer_id)}</h2>
          <div class="detail-grid">${["pan","dob","address","identity_ref","status","submitted_at"].map(x =>
            `<div class="detail-item"><small>${esc(x)}</small><b>${esc(k[x]||"—")}</b></div>`
          ).join("")}</div>
          ${k.video_view_url ? `<p><a class="btn secondary" target="_blank" rel="noopener" href="${esc(k.video_view_url)}">Open verification video</a></p>` : ""}
          <label>Reviewer remarks<textarea id="kycRemarks" rows="3"></textarea></label>
          <div class="button-row">
            <button class="btn primary" data-review="APPROVED">Approve</button>
            <button class="btn secondary" data-review="RESUBMIT">Request Resubmission</button>
            <button class="btn ghost" data-review="REJECTED">Reject</button>
          </div>`;
        $("kycDialog").showModal();
        $("kycDetail").onclick = async ev => {
          const status=ev.target.dataset.review; if(!status) return;
          try {
            await adminCall("reviewKyc", {customer_id:id,status,remarks:$("kycRemarks").value});
            location.reload();
          } catch(err) { alert(err.message); }
        };
      });
    } catch (err) { if (!sessionFailure(err)) alert(err.message); }
  }

  async function initAdminTrades() {
    const form=$("tradeForm"), tbody=$("adminTradeRows"); if(!form || !tbody) return;
    let rows=[];
    const refresh=async()=>{
      const r=await adminCall("adminTrades"); rows=r.trades||[];
      tbody.innerHTML=rows.map(t=>`<tr><td>${esc(t.trade_id)}</td><td>${esc(t.customer_id)}</td>
      <td>${esc(t.trade_date)}</td><td><b>${esc(t.symbol)}</b></td><td>${esc(t.quantity)}</td>
      <td class="${Number(t.net_pnl)>=0?"pnl-pos":"pnl-neg"}">${money(t.net_pnl)}</td><td>${esc(t.status)}</td></tr>`).join("")
      ||'<tr><td colspan="7">No trades.</td></tr>';
    };
    try { await refresh(); } catch(err) { if(!sessionFailure(err)) alert(err.message); return; }
    const calc=()=>{
      const f=new FormData(form), q=+f.get("quantity")||0, en=+f.get("entry_price")||0,
      ex=+f.get("exit_price")||0, ch=+f.get("charges")||0, type=f.get("trade_type");
      let pnl=(type==="SELL"?(en-ex):(ex-en))*q-ch;
      if(f.get("status")!=="CLOSED") pnl=0;
      $("previewPnl").textContent=money(pnl);
    };
    form.addEventListener("input",calc);
    form.addEventListener("submit",async e=>{
      e.preventDefault();
      try{
        await adminCall("adminCreateTrade", Object.fromEntries(new FormData(form)));
        setMessage($("message"),"Trade saved and metrics recalculated.","success");
        form.reset(); calc(); await refresh();
      }catch(err){setMessage($("message"),err.message,"error");}
    });
  }

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
    const queue=$("liveKycQueue");
    if(!queue) return;

    let activeSessionId="";
    let localStream=null;
    let peer=null;
    let queueTimer=null;
    let signalTimer=null;
    let lastSignalSeq=0;
    let pendingIce=[];
    let customerOfferHandled=false;

    const statusPill=$("agentCallStatus");
    const setAgentStatus=(text,cls="")=>{
      statusPill.textContent=text;
      statusPill.className=`status-pill ${cls}`.trim();
    };
    const stopSignal=()=>{if(signalTimer)clearInterval(signalTimer);signalTimer=null;};
    const closePeer=()=>{
      stopSignal();
      try{peer?.close();}catch(_){}
      peer=null;customerOfferHandled=false;pendingIce=[];lastSignalSeq=0;
      localStream?.getTracks().forEach(t=>t.stop());localStream=null;
      if($("agentLocalVideo"))$("agentLocalVideo").srcObject=null;
      if($("agentRemoteVideo"))$("agentRemoteVideo").srcObject=null;
      ["markVerified","markResubmit","markRejected"].forEach(id=>{$(id).disabled=true;});
    };

    async function sendAgentSignal(type,payload){
      return adminCall("liveKycSignalSend",{
        session_id:activeSessionId,participant:"AGENT",type,payload_json:JSON.stringify(payload)
      });
    }
    async function flushAgentIce(){
      if(!peer?.remoteDescription)return;
      const q=[...pendingIce];pendingIce=[];
      for(const c of q){try{await peer.addIceCandidate(c);}catch(_){}}
    }
    async function ensureAgentMedia(){
      if(localStream)return;
      localStream=await navigator.mediaDevices.getUserMedia({
        video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:15,max:24}},
        audio:{echoCancellation:true,noiseSuppression:true}
      });
      $("agentLocalVideo").srcObject=localStream;
    }
    async function handleCustomerOffer(desc){
      if(customerOfferHandled)return;
      customerOfferHandled=true;
      await ensureAgentMedia();
      peer=new RTCPeerConnection(RTC_CONFIG);
      localStream.getTracks().forEach(t=>peer.addTrack(t,localStream));
      peer.ontrack=ev=>{const s=ev.streams?.[0];if(s)$("agentRemoteVideo").srcObject=s;};
      peer.onicecandidate=ev=>{if(ev.candidate)sendAgentSignal("ICE",ev.candidate.toJSON?ev.candidate.toJSON():ev.candidate).catch(()=>{});};
      peer.onconnectionstatechange=async()=>{
        const s=peer.connectionState;
        if(s==="connected"){
          setAgentStatus("LIVE","success");
          ["markVerified","markResubmit","markRejected"].forEach(id=>{$(id).disabled=false;});
          try{await adminCall("agentMarkLiveKycConnected",{session_id:activeSessionId});}catch(_){}
          setMessage($("agentLiveMessage"),"Live peer-to-peer KYC connection established.","success");
        }else if(["failed","disconnected"].includes(s)){
          setAgentStatus("Connection interrupted","warning");
        }
      };
      await peer.setRemoteDescription(desc);
      await flushAgentIce();
      const answer=await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await sendAgentSignal("ANSWER",{type:answer.type,sdp:answer.sdp});
    }
    async function pollAgentSignals(){
      if(!activeSessionId)return;
      try{
        const r=await adminCall("liveKycSignalPoll",{
          session_id:activeSessionId,participant:"AGENT",after_seq:lastSignalSeq
        });
        for(const s of (r.signals||[])){
          lastSignalSeq=Math.max(lastSignalSeq,Number(s.seq||0));
          const payload=JSON.parse(s.payload_json||"{}");
          if(s.type==="OFFER") await handleCustomerOffer(payload);
          else if(s.type==="ICE"){
            const cand=new RTCIceCandidate(payload);
            if(peer?.remoteDescription){try{await peer.addIceCandidate(cand);}catch(_){}}
            else pendingIce.push(cand);
          }
        }
      }catch(err){console.warn("Agent KYC signal:",err.message);}
    }

    async function loadQueue(){
      try{
        const r=await adminCall("agentLiveKycQueue");
        const items=r.sessions||[];
        $("liveQueuePill").textContent=`${items.filter(x=>x.status==="WAITING_AGENT").length} waiting`;
        $("liveQueuePill").className=`status-pill ${items.some(x=>x.status==="WAITING_AGENT")?"warning":"success"}`;
        queue.innerHTML=items.map(x=>`
          <div class="live-queue-item ${x.status==="WAITING_AGENT"?"waiting":"mine"}">
            <h3>${esc(x.full_name)} · ${esc(x.customer_id)}</h3>
            <div class="live-queue-meta">
              <span>${esc(x.status)}</span><span>${esc(x.email)}</span><span>PAN ${esc(x.pan_masked||"—")}</span>
              <span>Waiting ${esc(x.wait_minutes)} min</span>
            </div>
            <button class="btn ${x.status==="WAITING_AGENT"?"primary":"secondary"}" data-live-session="${esc(x.session_id)}">
              ${x.status==="WAITING_AGENT"?"Accept & Join":"Open Session"}
            </button>
          </div>`).join("") || '<div class="alert success">No customers are waiting for live verification.</div>';
      }catch(err){
        if(!sessionFailure(err))queue.innerHTML=`<div class="alert danger">${esc(err.message)}</div>`;
      }
    }

    queue.addEventListener("click",async e=>{
      const id=e.target.dataset.liveSession;if(!id)return;
      try{
        closePeer();
        const r=await adminCall("agentAcceptLiveKyc",{session_id:id});
        activeSessionId=id;
        $("agentCallTitle").textContent=`${r.customer.full_name} · ${r.customer.customer_id}`;
        $("agentCustomerSummary").innerHTML=[
          ["Email",r.customer.email],["Mobile",r.customer.mobile],["PAN",r.customer.pan_masked],
          ["DOB",r.customer.dob],["Address",r.customer.address],["Agreement",r.customer.agreement_version]
        ].map(([k,v])=>`<div class="detail-item"><small>${esc(k)}</small><b>${esc(v||"—")}</b></div>`).join("");
        setAgentStatus("Waiting for customer connection","warning");
        setMessage($("agentLiveMessage"),"Session accepted. Waiting for the customer's WebRTC offer…");
        await ensureAgentMedia();
        signalTimer=setInterval(pollAgentSignals,1200);
        await pollAgentSignals();
        await loadQueue();
      }catch(err){setMessage($("agentLiveMessage"),err.message,"error");}
    });

    async function finish(result){
      if(!activeSessionId)return;
      const remarks=$("liveKycRemarks").value||"";
      if(!remarks && result!=="VERIFIED") {
        return setMessage($("agentLiveMessage"),"Enter remarks before requesting re-verification or rejecting.","error");
      }
      try{
        await adminCall("agentCompleteLiveKyc",{session_id:activeSessionId,result,remarks});
        setMessage($("agentLiveMessage"),
          result==="VERIFIED"?"Customer verified and account activated.":`Live KYC closed with result: ${result}.`,
          result==="VERIFIED"?"success":"error");
        setAgentStatus("Completed",result==="VERIFIED"?"success":"warning");
        closePeer();activeSessionId="";$("liveKycRemarks").value="";
        await loadQueue();
      }catch(err){setMessage($("agentLiveMessage"),err.message,"error");}
    }
    $("markVerified").addEventListener("click",()=>finish("VERIFIED"));
    $("markResubmit").addEventListener("click",()=>finish("RESUBMIT"));
    $("markRejected").addEventListener("click",()=>finish("REJECTED"));
    $("refreshLiveQueue").addEventListener("click",loadQueue);

    await loadQueue();
    queueTimer=setInterval(loadQueue,4000);
    window.addEventListener("beforeunload",()=>{if(queueTimer)clearInterval(queueTimer);closePeer();});
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
  }

  boot().catch(err => {
    console.error("SARKSH bootstrap error:", err);
    if (!sessionFailure(err)) {
      const target = $("message") || $("ledgerMessage") || $("reportMessage");
      if (target) setMessage(target, err.message, "error");
    }
  });
})();
