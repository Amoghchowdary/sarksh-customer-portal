
/**
 * SARKSH Customer + Admin Portal V5
 * SINGLE-FILE GOOGLE APPS SCRIPT BACKEND
 *
 * Architecture:
 * GitHub Pages -> this Apps Script Web App -> Google Sheets + private Google Drive
 *
 * No CacheService is used. All customer financial reads are calculated from source rows.
 * Use setupSarkshPortal() once before deployment.
 */

const SARKSH = {
  VERSION: '6.0.0',
  TIMEZONE: 'Asia/Kolkata',
  SESSION_HOURS: 12,
  PASSWORD_ITERATIONS: 1200,
  CUSTOMER_PREFIX: 'SAR',
  ADMIN_PREFIX: 'ADM',
  VIDEO_MAX_BYTES: 3 * 1024 * 1024,
  DOCUMENT_MAX_BYTES: 2 * 1024 * 1024,
  PROP_AADHAAR_PEPPER: 'SARKSH_AADHAAR_PEPPER',
  PROP_SHEET_ID: 'SARKSH_SHEET_ID',
  PROP_KYC_FOLDER_ID: 'SARKSH_KYC_FOLDER_ID',
  PRIMARY_ADMIN_EMAIL: 'grow@sarksh.in',
  EMAIL_OTP_MINUTES: 5,
  AUTH_CHALLENGE_MINUTES: 10
};

const TABS = {
  USERS:'01_USERS',
  CUSTOMERS:'02_CUSTOMERS',
  ADMINS:'03_ADMINS',
  ROLES:'04_ROLES',
  SESSIONS:'05_SESSIONS',
  KYC:'06_KYC',
  KYC_DOCS:'07_KYC_DOCUMENTS',
  TRADES:'08_TRADES',
  ACCOUNTS:'09_ACCOUNTS',
  LEDGER:'10_LEDGER',
  NOTIFICATIONS:'11_NOTIFICATIONS',
  AUDIT:'12_AUDIT_LOGS',
  SYSTEM:'13_SYSTEM_LOGS',
  BACKUPS:'14_BACKUPS',
  SETTINGS:'15_SETTINGS',
  AUTH:'16_AUTH_CHALLENGES',
  CONSENTS:'17_CONSENTS',
  REGISTRATIONS:'18_REGISTRATIONS',
  KYC_LIVE:'19_KYC_LIVE_SESSIONS',
  KYC_SIGNAL:'20_KYC_SIGNAL',
  CUSTOMER_TEAM:'21_CUSTOMER_TEAM',
  CUSTOMER_PREFS:'22_CUSTOMER_SETTINGS'
};

const HEADERS = {
  '01_USERS':['user_id','customer_id','email','password_hash','password_salt','role','status','created_at','last_login'],
  '02_CUSTOMERS':['customer_id','full_name','mobile','email','dob','pan_ref','address','kyc_status','account_status','created_at','updated_at'],
  '03_ADMINS':['admin_id','name','email','password_hash','password_salt','role','status','created_at','last_login','otp_email','totp_secret','totp_enabled','failed_attempts','locked_until'],
  '04_ROLES':['role','description'],
  '05_SESSIONS':['session_id','token_hash','user_id','role','created_at','expires_at','last_seen','revoked'],
  '06_KYC':['kyc_id','customer_id','pan','dob','address','identity_ref','aadhaar_masked','aadhaar_hmac','aadhaar_mode','status','submitted_at','reviewed_at','reviewed_by','remarks','video_file_id','video_view_url'],
  '07_KYC_DOCUMENTS':['document_id','customer_id','document_type','file_id','file_url','file_name','mime_type','status','uploaded_by','remarks','masked_reference','sha256','created_at'],
  '08_TRADES':['trade_id','customer_id','trade_date','symbol','exchange','trade_type','quantity','entry_price','exit_price','gross_pnl','charges','net_pnl','status','entered_by','created_at','updated_at'],
  '09_ACCOUNTS':['account_id','customer_id','status','opening_balance','created_at','updated_at'],
  '10_LEDGER':['transaction_id','customer_id','date','type','amount','signed_amount','reference','description','created_at','created_by'],
  '11_NOTIFICATIONS':['notification_id','customer_id','type','message','status','created_at'],
  '12_AUDIT_LOGS':['log_id','timestamp','actor_id','actor_role','action','entity_type','entity_id','result','details'],
  '13_SYSTEM_LOGS':['log_id','timestamp','level','event','detail'],
  '14_BACKUPS':['backup_id','timestamp','status','reference','detail'],
  '15_SETTINGS':['key','value','updated_at'],
  '16_AUTH_CHALLENGES':['challenge_id','admin_id','stage','otp_hash','expires_at','attempts','created_at','used'],
  '17_CONSENTS':['consent_id','customer_id','agreement_title','agreement_version','agreement_hash','accepted_name','accepted_at','request_id','user_agent','status'],
  '18_REGISTRATIONS':['registration_id','token_hash','user_id','customer_id','expires_at','used','created_at','status','live_kyc_session_id'],
  '19_KYC_LIVE_SESSIONS':['session_id','customer_id','user_id','registration_id','status','assigned_agent_id','meet_url','calendar_event_id','scheduled_start','scheduled_end','meet_created_at','created_at','accepted_at','started_at','ended_at','result','remarks'],
  '20_KYC_SIGNAL':['signal_id','session_id','sender','seq','type','payload_json','created_at'],
  '21_CUSTOMER_TEAM':['assignment_id','customer_id','member_name','role','email','phone','status','assigned_at','assigned_by'],
  '22_CUSTOMER_SETTINGS':['customer_id','preferred_name','email_notifications','trade_notifications','compact_dashboard','show_trade_quality','updated_at']
};

/* =========================================================
   ONE-TIME SETUP
   ========================================================= */
function setupSarkshPortal() {
  const props=PropertiesService.getScriptProperties();
  let spreadsheet;
  const sheetId=props.getProperty(SARKSH.PROP_SHEET_ID);

  if(sheetId){
    // IMPORTANT: Existing V3/V4 database is reused in-place.
    spreadsheet=SpreadsheetApp.openById(sheetId);
  } else {
    spreadsheet=SpreadsheetApp.create('SARKSH Portal Database');
    props.setProperty(SARKSH.PROP_SHEET_ID,spreadsheet.getId());
  }

  Object.keys(HEADERS).forEach(name=>ensureSheetSchema_(spreadsheet,name,HEADERS[name]));

  let folderId=props.getProperty(SARKSH.PROP_KYC_FOLDER_ID);
  if(!folderId){
    const folder=DriveApp.createFolder('SARKSH_PRIVATE_KYC');
    props.setProperty(SARKSH.PROP_KYC_FOLDER_ID,folder.getId());
    folderId=folder.getId();
  }

  seedRoles_();
  ensureRole_('KYC_AGENT','Live KYC verification agent');
  putSetting_('backend_version',SARKSH.VERSION);
  ensureSetting_('registration_agreement_title','Loan Agreement');
  ensureSetting_('registration_agreement_version','DRAFT-NOT-CONFIGURED');
  ensureSetting_('registration_agreement_text','Agreement document has not yet been configured by the Super Admin.');
  ensureSetting_('registration_agreement_ready','FALSE');
  ensureAadhaarPepper_();

  Logger.log('SARKSH V5 backend ready.');
  Logger.log('Existing database preserved: '+spreadsheet.getUrl());
  Logger.log('KYC folder: '+folderId);
}

/**
 * Recommended for this V3 -> V5 upgrade.
 * Makes a Drive copy of the existing database, then performs an additive schema migration.
 * Existing customer rows, trades, ledger entries, sessions and KYC records are never cleared.
 */
function migrateExistingDatabaseToV6() {
  const props=PropertiesService.getScriptProperties();
  const sheetId=props.getProperty(SARKSH.PROP_SHEET_ID);
  if(!sheetId) throw new Error('Existing SARKSH database property not found. Do not continue until the V3 Apps Script project is being used.');

  const ss=SpreadsheetApp.openById(sheetId);
  const backupName='SARKSH Portal DB PRE-V6 '+Utilities.formatDate(new Date(),SARKSH.TIMEZONE,'yyyy-MM-dd_HH-mm-ss');
  const backup=DriveApp.getFileById(sheetId).makeCopy(backupName);

  appendMigrationBackupLog_(backup);
  Object.keys(HEADERS).forEach(name=>ensureSheetSchema_(ss,name,HEADERS[name]));
  seedRoles_();
  ensureRole_('KYC_AGENT','Live KYC verification agent');
  putSetting_('backend_version',SARKSH.VERSION);
  ensureSetting_('registration_agreement_title','Loan Agreement');
  ensureSetting_('registration_agreement_version','DRAFT-NOT-CONFIGURED');
  ensureSetting_('registration_agreement_text','Agreement document has not yet been configured by the Super Admin.');
  ensureSetting_('registration_agreement_ready','FALSE');
  ensureAadhaarPepper_();

  Logger.log('EXISTING CUSTOMER DATABASE PRESERVED.');
  Logger.log('Live database: '+ss.getUrl());
  Logger.log('Pre-V5 backup: '+backup.getUrl());
  Logger.log('Only missing V6 tabs/columns were added. Existing customer rows were preserved.');
  return {database_url:ss.getUrl(),backup_url:backup.getUrl()};
}

function appendMigrationBackupLog_(file) {
  try{
    const sh=sheet_(TABS.BACKUPS);
    const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
    const row={
      backup_id:makeId_('BAK'),timestamp:now_(),status:'SUCCESS',
      reference:file.getId(),detail:'Automatic pre-V6 migration backup'
    };
    sh.appendRow(h.map(k=>row[k]===undefined?'':row[k]));
  }catch(_){}
}



/* Run after setupSarkshPortal(). Generates/rotates the primary admin password.
   Copy the generated password from Execution log and store it securely. */
function setupPrimaryAdminSecurity() {
  const email=SARKSH.PRIMARY_ADMIN_EMAIL;
  const password=generateStrongPassword_(22);
  let admin=getRows_(TABS.ADMINS).find(x=>normalizeEmail_(x.email)===email);
  const salt=newSalt_();
  const patch={
    name:'SARKSH Super Admin',email,password_hash:hashPassword_(password,salt),password_salt:salt,
    role:'SUPER_ADMIN',status:'ACTIVE',otp_email:email,failed_attempts:0,locked_until:'',
    totp_secret:admin?String(admin.totp_secret||''):'',totp_enabled:admin?String(admin.totp_enabled||'FALSE'):'FALSE'
  };
  if(admin) {
    updateRow_(TABS.ADMINS,admin.__row,patch);
    revokeAdminSessions_(admin.admin_id);
  } else {
    const adminId=makeId_(SARKSH.ADMIN_PREFIX);
    appendRow_(TABS.ADMINS,{admin_id:adminId,...patch,created_at:now_(),last_login:''});
    admin=getRows_(TABS.ADMINS).find(x=>x.admin_id===adminId);
  }
  audit_(admin.admin_id,'SUPER_ADMIN','ADMIN_PASSWORD_ROTATE','ADMIN',admin.admin_id,'SUCCESS','Password generated from Apps Script');
  Logger.log('=============================================');
  Logger.log('SARKSH PRIMARY ADMIN EMAIL: '+email);
  Logger.log('ONE-TIME GENERATED ADMIN PASSWORD: '+password);
  Logger.log('Copy it now and store it securely. Re-running this function ROTATES the password.');
  Logger.log('=============================================');
  return 'Password generated. Read the Execution log.';
}

/* Recovery from the Apps Script editor if the Authenticator device is lost.
   This disables TOTP and revokes existing admin sessions. The next successful
   password + email OTP login will require fresh Google Authenticator enrollment. */
function resetPrimaryAdminAuthenticator() {
  const admin=getRows_(TABS.ADMINS).find(x=>normalizeEmail_(x.email)===SARKSH.PRIMARY_ADMIN_EMAIL);
  if(!admin) throw new Error('Primary admin is not configured.');
  updateRow_(TABS.ADMINS,admin.__row,{totp_secret:'',totp_enabled:'FALSE'});
  revokeAdminSessions_(admin.admin_id);
  audit_(admin.admin_id,'SUPER_ADMIN','TOTP_RESET','ADMIN',admin.admin_id,'SUCCESS','Reset from Apps Script editor');
  Logger.log('Google Authenticator reset. Next login requires new enrollment.');
}

/* =========================================================
   WEB APP ENTRY
   ========================================================= */
function doGet() {
  return json_({
    ok:true,
    service:'SARKSH Portal Backend',
    version:SARKSH.VERSION,
    timestamp:now_()
  });
}

function doPost(e) {
  const started = Date.now();
  let payload = {};
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(payload.action || '').trim();
    if (!action) throw new Error('Missing action.');

    const routes = {
      getRegistrationAgreement: getRegistrationAgreement_,
      registrationResumeStatus: registrationResumeStatus_,
      uploadRegistrationDocument: uploadRegistrationDocument_,
      registerCustomer: registerCustomer_,
      createLiveKycSession: createLiveKycSession_,
      liveKycStatus: liveKycStatus_,
      liveKycSignalSend: liveKycSignalSend_,
      liveKycSignalPoll: liveKycSignalPoll_,
      loginCustomer: loginCustomer_,
      logout: p => logout_(p.token),
      customerDashboard: customerDashboard_,
      customerTrades: customerTrades_,
      getKycCenter: getKycCenter_,
      uploadCustomerDocument: uploadCustomerDocument_,
      requestCustomerMeetKyc: requestCustomerMeetKyc_,
      customerMeetKycStatus: customerMeetKycStatus_,
      customerSettingsGet: customerSettingsGet_,
      customerSettingsSave: customerSettingsSave_,
      customerChangePassword: customerChangePassword_,
      customerTeam: customerTeam_,
      getKyc: getKyc_,
      submitKyc: submitKyc_,
      uploadKycVideo: uploadKycVideo_,

      adminLoginStart: adminLoginStart_,
      adminVerifyEmailOtp: adminVerifyEmailOtp_,
      adminVerifyTotp: adminVerifyTotp_,
      adminDashboard: adminDashboard_,
      adminCustomers: adminCustomers_,
      adminCustomerDetail: adminCustomerDetail_,
      adminCustomerDashboard: adminCustomerDashboard_,
      adminKycQueue: adminKycQueue_,
      reviewKyc: reviewKyc_,
      adminTrades: adminTrades_,
      adminCreateTrade: adminCreateTrade_,
      adminAccounts: adminAccounts_,
      adminLedgerEntry: adminLedgerEntry_,
      adminMonitoring: adminMonitoring_,
      adminAudit: adminAudit_,
      adminListAdmins: adminListAdmins_,
      adminCreateAdmin: adminCreateAdmin_,
      adminSetAdminStatus: adminSetAdminStatus_,
      adminAssignCustomerTeam: adminAssignCustomerTeam_,
      adminAgreementGet: adminAgreementGet_,
      adminAgreementSave: adminAgreementSave_,
      agentLiveKycQueue: agentLiveKycQueue_,
      agentAcceptLiveKyc: agentAcceptLiveKyc_,
      agentCreateMeetKyc: agentCreateMeetKyc_,
      agentMarkLiveKycConnected: agentMarkLiveKycConnected_,
      agentCompleteLiveKyc: agentCompleteLiveKyc_
    };

    if (!routes[action]) throw new Error('Unknown action: ' + action);
    const result = routes[action](payload) || {ok:true};

    if (result.ok !== true) result.ok = true;
    result.server_version = SARKSH.VERSION;
    result.server_ms = Date.now() - started;
    result.response_timestamp = now_();
    return json_(result);
  } catch (err) {
    try { systemLog_('ERROR','API',String(err && (err.stack || err.message) || err)); } catch (_) {}
    return json_({
      ok:false,
      error:err && err.message ? err.message : 'Server error',
      server_version:SARKSH.VERSION,
      server_ms:Date.now()-started,
      response_timestamp:now_()
    });
  }
}

/* =========================================================
   DATABASE HELPERS
   ========================================================= */
function ensureSheetSchema_(spreadsheet,name,headers) {
  let sh=spreadsheet.getSheetByName(name);
  if(!sh) sh=spreadsheet.insertSheet(name);
  if(sh.getLastRow()===0) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    return;
  }
  const width=Math.max(sh.getLastColumn(),1);
  const existing=sh.getRange(1,1,1,width).getValues()[0].map(String);
  const missing=headers.filter(h=>!existing.includes(h));
  if(missing.length) sh.getRange(1,existing.length+1,1,missing.length).setValues([missing]);
  sh.setFrozenRows(1);
}

function db_() {
  const id = PropertiesService.getScriptProperties().getProperty(SARKSH.PROP_SHEET_ID);
  if (!id) throw new Error('Database is not configured. Run setupSarkshPortal().');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  const sh = db_().getSheetByName(name);
  if (!sh) throw new Error('Missing database tab: ' + name);
  return sh;
}

function getRows_(name) {
  const sh = sheet_(name);
  const range = sh.getDataRange();
  const values = range.getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1)
    .map((row, i) => ({row, rowNo:i+2}))
    .filter(x => x.row.some(v => v !== '' && v !== null))
    .map(x => {
      const out = {};
      headers.forEach((h,j) => out[h] = x.row[j]);
      out.__row = x.rowNo;
      return out;
    });
}

function appendRow_(name, obj) {
  return withWriteLock_(() => {
    const sh = sheet_(name);
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
    sh.appendRow(headers.map(k => obj[k] === undefined ? '' : obj[k]));
    return true;
  });
}

function updateRow_(name, rowNo, patch) {
  return withWriteLock_(() => {
    const sh = sheet_(name);
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
    const current = sh.getRange(rowNo,1,1,headers.length).getValues()[0];
    headers.forEach((k,i) => {
      if (Object.prototype.hasOwnProperty.call(patch,k)) current[i] = patch[k];
    });
    sh.getRange(rowNo,1,1,headers.length).setValues([current]);
    return true;
  });
}

function updateRowUnlocked_(name,rowNo,patch) {
  const sh=sheet_(name);
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  const current=sh.getRange(rowNo,1,1,headers.length).getValues()[0];
  headers.forEach((k,i)=>{if(Object.prototype.hasOwnProperty.call(patch,k))current[i]=patch[k];});
  sh.getRange(rowNo,1,1,headers.length).setValues([current]);
}

function appendRowUnlocked_(name,obj) {
  const sh=sheet_(name);
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(headers.map(k=>obj[k]===undefined?'':obj[k]));
}


function withWriteLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function putSetting_(key,value) {
  const rows = getRows_(TABS.SETTINGS);
  const existing = rows.find(x => String(x.key) === String(key));
  if (existing) updateRow_(TABS.SETTINGS, existing.__row, {value,updated_at:now_()});
  else appendRow_(TABS.SETTINGS,{key,value,updated_at:now_()});
}

function ensureSetting_(key,value) {
  const exists=getRows_(TABS.SETTINGS).some(x=>String(x.key)===String(key));
  if(!exists) appendRow_(TABS.SETTINGS,{key,value,updated_at:now_()});
}
function getSetting_(key,fallback) {
  const row=getRows_(TABS.SETTINGS).find(x=>String(x.key)===String(key));
  return row ? row.value : fallback;
}
function currentAgreement_() {
  const title=String(getSetting_('registration_agreement_title','Loan Agreement'));
  const version=String(getSetting_('registration_agreement_version',''));
  const text=String(getSetting_('registration_agreement_text',''));
  const ready=String(getSetting_('registration_agreement_ready','FALSE')).toUpperCase()==='TRUE';
  const hash=hexDigest_(title+'|'+version+'|'+text);
  return {title,version,text,ready,hash};
}

/* =========================================================
   SECURITY
   ========================================================= */
function normalizeEmail_(s) { return String(s || '').trim().toLowerCase(); }
function now_() { return new Date().toISOString(); }
function today_() { return Utilities.formatDate(new Date(), SARKSH.TIMEZONE, 'yyyy-MM-dd'); }
function makeId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), SARKSH.TIMEZONE, 'yyMMdd') +
    Utilities.getUuid().replace(/-/g,'').slice(0,8).toUpperCase();
}
function newSalt_() {
  return Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
}
function hexDigest_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value),Utilities.Charset.UTF_8);
  return bytes.map(b => ('0'+((b<0?b+256:b).toString(16))).slice(-2)).join('');
}
function hashPassword_(password,salt) {
  let out = String(password) + ':' + String(salt);
  for (let i=0;i<SARKSH.PASSWORD_ITERATIONS;i++) out = hexDigest_(out);
  return out;
}
function makeSession_(userId, role) {
  const raw = Utilities.getUuid() + ':' + Date.now() + ':' + Math.random();
  const token = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw)).replace(/=+$/,'');
  appendRow_(TABS.SESSIONS,{
    session_id:makeId_('SES'),
    token_hash:hexDigest_(token),
    user_id:userId,
    role,
    created_at:now_(),
    expires_at:new Date(Date.now()+SARKSH.SESSION_HOURS*3600000).toISOString(),
    last_seen:now_(),
    revoked:'FALSE'
  });
  return token;
}
function getSession_(token, expectedRole) {
  if (!token) throw new Error('Missing session token.');
  const hash = hexDigest_(token);
  const s = getRows_(TABS.SESSIONS).find(x => x.token_hash === hash && String(x.revoked) !== 'TRUE');
  if (!s || new Date(s.expires_at) <= new Date()) throw new Error('Session expired.');
  if (expectedRole && String(s.role) !== String(expectedRole)) throw new Error('Invalid session role.');
  updateRow_(TABS.SESSIONS,s.__row,{last_seen:now_()});
  return s;
}
function logout_(token) {
  if (!token) return {ok:true};
  const hash=hexDigest_(token);
  const s=getRows_(TABS.SESSIONS).find(x=>x.token_hash===hash);
  if(s) updateRow_(TABS.SESSIONS,s.__row,{revoked:'TRUE',last_seen:now_()});
  return {ok:true};
}
function requireAdmin_(token, allowedRoles) {
  const s = getSession_(token,'ADMIN');
  const admin = getRows_(TABS.ADMINS).find(x=>x.admin_id===s.user_id && String(x.status)==='ACTIVE');
  if (!admin) throw new Error('Admin account is not active.');
  if (allowedRoles && allowedRoles.length && !allowedRoles.includes(String(admin.role))) {
    throw new Error('Insufficient admin permission.');
  }
  return admin;
}
function customerContext_(token) {
  const s=getSession_(token,'CUSTOMER');
  const user=getRows_(TABS.USERS).find(x=>x.user_id===s.user_id && String(x.status)==='ACTIVE');
  if(!user) throw new Error('Customer user not active.');
  const customer=getRows_(TABS.CUSTOMERS).find(x=>x.customer_id===user.customer_id);
  if(!customer) throw new Error('Customer profile not found.');
  return {session:s,user,customer};
}

function generateStrongPassword_(length) {
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_';
  let seed='';
  while(seed.length<length*2) seed+=hexDigest_(Utilities.getUuid()+':'+Date.now()+':'+Math.random());
  let out='';
  for(let i=0;i<length;i++) out+=alphabet[parseInt(seed.substr(i*2,2),16)%alphabet.length];
  return out;
}
function randomOtp_() {
  const hex=hexDigest_(Utilities.getUuid()+':'+Date.now()+':'+Math.random());
  return String(parseInt(hex.slice(0,10),16)%1000000).padStart(6,'0');
}
function maskEmail_(email) {
  const parts=String(email).split('@'); if(parts.length!==2)return 'admin mailbox';
  const u=parts[0]; return (u.slice(0,2)+'***'+u.slice(-1))+'@'+parts[1];
}
function revokeAdminSessions_(adminId) {
  getRows_(TABS.SESSIONS).filter(x=>x.user_id===adminId&&String(x.revoked)!=='TRUE').forEach(x=>updateRow_(TABS.SESSIONS,x.__row,{revoked:'TRUE'}));
}
function createAdminChallenge_(admin) {
  const otp=randomOtp_(), challengeId=makeId_('CHL'), expires=new Date(Date.now()+SARKSH.EMAIL_OTP_MINUTES*60000).toISOString();
  appendRow_(TABS.AUTH,{challenge_id:challengeId,admin_id:admin.admin_id,stage:'PASSWORD_VERIFIED',otp_hash:hexDigest_(challengeId+':'+otp),expires_at:expires,attempts:0,created_at:now_(),used:'FALSE'});
  const email=normalizeEmail_(admin.otp_email||admin.email);
  MailApp.sendEmail({to:email,subject:'SARKSH Admin Login OTP',htmlBody:'<p>A SARKSH Admin Control Centre login was initiated.</p><p>Your one-time password is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">'+otp+'</p><p>This OTP expires in '+SARKSH.EMAIL_OTP_MINUTES+' minutes. If you did not initiate this login, rotate the admin password immediately.</p>'});
  return {challengeId,email};
}
function challenge_(id,allowedStages) {
  const c=getRows_(TABS.AUTH).find(x=>x.challenge_id===String(id||'')&&String(x.used)!=='TRUE');
  if(!c||new Date(c.expires_at)<=new Date()) throw new Error('Authentication challenge expired. Start again.');
  if(allowedStages&&allowedStages.length&&!allowedStages.includes(String(c.stage))) throw new Error('Authentication step is out of sequence.');
  if(Number(c.attempts||0)>=6) throw new Error('Too many verification attempts. Start again.');
  return c;
}
function base32Encode_(bytes) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=0,value=0,out='';
  bytes.forEach(b=>{value=(value<<8)|(b&255);bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}});
  if(bits>0) out+=alphabet[(value<<(5-bits))&31]; return out;
}
function base32Decode_(s) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=0,value=0,out=[];
  String(s||'').toUpperCase().replace(/=|\s/g,'').split('').forEach(ch=>{const idx=alphabet.indexOf(ch);if(idx<0)return;value=(value<<5)|idx;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}});return out;
}
function generateTotpSecret_() {
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,Utilities.getUuid()+':'+Date.now()+':'+Math.random()).slice(0,20).map(b=>b<0?b+256:b);
  return base32Encode_(bytes);
}
function hotp_(secret,counter) {
  const key=base32Decode_(secret), msg=[];
  for(let i=7;i>=0;i--) msg.push(Math.floor(counter/Math.pow(256,i))&255);
  const sig=Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1,msg,key);
  const bytes=sig.map(b=>b<0?b+256:b), offset=bytes[bytes.length-1]&15;
  const bin=((bytes[offset]&127)<<24)|((bytes[offset+1]&255)<<16)|((bytes[offset+2]&255)<<8)|(bytes[offset+3]&255);
  return String((bin>>>0)%1000000).padStart(6,'0');
}
function verifyTotp_(secret,code) {
  code=String(code||'').trim(); if(!/^\d{6}$/.test(code))return false;
  const counter=Math.floor(Date.now()/1000/30);
  for(let w=-1;w<=1;w++) if(hotp_(secret,counter+w)===code)return true;
  return false;
}


function ensureAadhaarPepper_() {
  const props=PropertiesService.getScriptProperties();
  if(!props.getProperty(SARKSH.PROP_AADHAAR_PEPPER))
    props.setProperty(SARKSH.PROP_AADHAAR_PEPPER,Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''));
}
function aadhaarReference_(value) {
  const n=String(value||'').replace(/\D/g,'');
  if(!n) return {masked:'',hmac:'',mode:''};
  if(!/^[2-9][0-9]{11}$/.test(n)) throw new Error('Aadhaar number must be a valid 12-digit number.');
  ensureAadhaarPepper_();
  const pepper=PropertiesService.getScriptProperties().getProperty(SARKSH.PROP_AADHAAR_PEPPER);
  const sig=Utilities.computeHmacSha256Signature(n,pepper,Utilities.Charset.UTF_8);
  const hmac=sig.map(b=>('0'+((b<0?b+256:b).toString(16))).slice(-2)).join('');
  return {masked:'XXXX-XXXX-'+n.slice(-4),hmac,mode:'NUMBER'};
}
function sanitizeDocType_(t) {
  const v=String(t||'').toUpperCase();
  const allowed=['PAN_CARD','AADHAAR','ADDRESS_PROOF','PHOTO','OTHER'];
  if(!allowed.includes(v)) throw new Error('Unsupported KYC document type.');
  return v;
}
function decodeDocument_(b64) {
  let s=String(b64||'').replace(/^data:[^;]+;base64,/i,'').replace(/\s/g,'');
  const mod=s.length%4;if(mod===1)throw new Error('Document upload is incomplete.');if(mod)s+='='.repeat(4-mod);
  try{return Utilities.base64Decode(s);}catch(_){throw new Error('Document could not be decoded. Re-select the file and try again.');}
}
function saveKycDocument_(customerId,documentType,fileName,mimeType,fileBase64,uploadedBy,reference) {
  const type=sanitizeDocType_(documentType),mime=String(mimeType||'');
  if(!['application/pdf','image/jpeg','image/png'].includes(mime)) throw new Error('Only PDF, JPG and PNG KYC documents are supported.');
  const bytes=decodeDocument_(fileBase64);
  if(!bytes.length||bytes.length>SARKSH.DOCUMENT_MAX_BYTES) throw new Error('KYC document must be 2 MB or smaller.');
  const folderId=PropertiesService.getScriptProperties().getProperty(SARKSH.PROP_KYC_FOLDER_ID);
  if(!folderId) throw new Error('KYC Drive storage is not configured.');
  const safeName=customerId+'_'+type+'_'+Date.now()+'_'+String(fileName||'document').replace(/[^A-Za-z0-9._-]/g,'_');
  const file=DriveApp.getFolderById(folderId).createFile(Utilities.newBlob(bytes,mime,safeName));
  appendRow_(TABS.KYC_DOCS,{
    document_id:makeId_('DOC'),customer_id:customerId,document_type:type,file_id:file.getId(),file_url:file.getUrl(),
    file_name:String(fileName||safeName),mime_type:mime,status:'RECEIVED',uploaded_by:uploadedBy||'CUSTOMER',
    remarks:'',masked_reference:String(reference||''),sha256:hexDigest_(Utilities.base64Encode(bytes)),created_at:now_()
  });
  return file;
}
function safeCustomerDocs_(customerId,includeUrl) {
  return getRows_(TABS.KYC_DOCS).filter(x=>x.customer_id===customerId).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).map(x=>({
    document_id:x.document_id,document_type:x.document_type,file_name:x.file_name,mime_type:x.mime_type,status:x.status,
    remarks:x.remarks||'',masked_reference:x.masked_reference||'',created_at:x.created_at,
    file_url:includeUrl?x.file_url:''
  }));
}

/* =========================================================
   AUDIT / SYSTEM LOGS
   ========================================================= */
function audit_(actorId,actorRole,action,entityType,entityId,result,details) {
  appendRow_(TABS.AUDIT,{
    log_id:makeId_('LOG'),timestamp:now_(),actor_id:actorId||'SYSTEM',actor_role:actorRole||'SYSTEM',
    action:action||'',entity_type:entityType||'',entity_id:entityId||'',result:result||'SUCCESS',
    details:details||''
  });
}
function systemLog_(level,event,detail) {
  appendRow_(TABS.SYSTEM,{log_id:makeId_('SYS'),timestamp:now_(),level,event,detail:detail||''});
}

/* =========================================================
   CUSTOMER AUTH / REGISTRATION
   ========================================================= */
function getRegistrationAgreement_() {
  return {ok:true,agreement:currentAgreement_()};
}

function registerCustomer_(p) {
  const email=normalizeEmail_(p.email), name=String(p.full_name||'').trim();
  const mobile=String(p.mobile||'').trim(), password=String(p.password||'');
  const pan=String(p.pan||'').trim().toUpperCase();
  const dob=String(p.dob||'').trim(), address=String(p.address||'').trim();
  const identityRef=String(p.identity_ref||'').trim();
  const aadhaar=aadhaarReference_(p.aadhaar_number);
  const acceptedName=String(p.accepted_name||'').trim();
  const agreement=currentAgreement_();

  if(!agreement.ready) throw new Error('Registration agreement is not active.');
  if(String(p.agreement_hash||'')!==agreement.hash || String(p.agreement_version||'')!==agreement.version)
    throw new Error('Agreement version changed. Reload registration and review the current document.');
  if(p.agreement_consent!==true) throw new Error('Agreement acceptance is required.');
  if(acceptedName.toLowerCase()!==name.toLowerCase()) throw new Error('Agreement name must match the full legal name.');
  if(!name) throw new Error('Full legal name is required.');
  if(!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Valid email is required.');
  if(!/^\d{10,15}$/.test(mobile)) throw new Error('Valid mobile number is required.');
  if(password.length<8) throw new Error('Password must be at least 8 characters.');
  if(!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new Error('PAN format is invalid.');
  if(!dob || !address || !identityRef) throw new Error('Complete all KYC fields.');
  if(getRows_(TABS.USERS).some(x=>normalizeEmail_(x.email)===email)) throw new Error('Email is already registered.');

  const customerId=makeId_(SARKSH.CUSTOMER_PREFIX), userId=makeId_('USR'), salt=newSalt_();
  const rawToken=Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,Utilities.getUuid()+':'+Date.now()+':'+email)
  ).replace(/=+$/,'');
  const regId=makeId_('REG'), created=now_();

  withWriteLock_(()=>{
    appendRowUnlocked_(TABS.USERS,{
      user_id:userId,customer_id:customerId,email,password_hash:hashPassword_(password,salt),
      password_salt:salt,role:'CUSTOMER',status:'PENDING_LIVE_KYC',created_at:created,last_login:''
    });
    appendRowUnlocked_(TABS.CUSTOMERS,{
      customer_id:customerId,full_name:name,mobile,email,dob,pan_ref:'PAN-****'+pan.slice(-4),address,
      kyc_status:'WAITING_LIVE_KYC',account_status:'REGISTRATION_INCOMPLETE',created_at:created,updated_at:created
    });
    appendRowUnlocked_(TABS.KYC,{
      kyc_id:makeId_('KYC'),customer_id:customerId,pan,dob,address,identity_ref:identityRef,
      aadhaar_masked:aadhaar.masked,aadhaar_hmac:aadhaar.hmac,aadhaar_mode:aadhaar.mode,
      status:'WAITING_LIVE_KYC',submitted_at:created,reviewed_at:'',reviewed_by:'',remarks:'',
      video_file_id:'',video_view_url:''
    });
    appendRowUnlocked_(TABS.ACCOUNTS,{
      account_id:makeId_('ACC'),customer_id:customerId,status:'PENDING',opening_balance:0,
      created_at:created,updated_at:created
    });
    appendRowUnlocked_(TABS.CONSENTS,{
      consent_id:makeId_('CON'),customer_id:customerId,agreement_title:agreement.title,
      agreement_version:agreement.version,agreement_hash:agreement.hash,accepted_name:acceptedName,
      accepted_at:created,request_id:String(p.request_id||''),user_agent:String(p.user_agent||''),status:'ACCEPTED'
    });
    appendRowUnlocked_(TABS.REGISTRATIONS,{
      registration_id:regId,token_hash:hexDigest_(rawToken),user_id:userId,customer_id:customerId,
      expires_at:new Date(Date.now()+24*60*60*1000).toISOString(),used:'FALSE',created_at:created,
      status:'WAITING_LIVE_KYC',live_kyc_session_id:''
    });
  });

  audit_(userId,'CUSTOMER','REGISTER_KYC_AGREEMENT','CUSTOMER',customerId,'SUCCESS',
    JSON.stringify({agreement_version:agreement.version,agreement_hash:agreement.hash}));
  return {ok:true,customer_id:customerId,registration_token:rawToken};
}


function decodeBase64Safe_(value) {
  let s=String(value||'').replace(/^data:[^;]+;base64,/i,'').replace(/\s/g,'');
  if(!s) throw new Error('Empty encoded payload.');
  const mod=s.length%4;
  if(mod===1) throw new Error('Verification video payload is incomplete. Record again.');
  if(mod) s += '='.repeat(4-mod);
  try { return Utilities.base64Decode(s); }
  catch(_) {
    try { return Utilities.base64DecodeWebSafe(s); }
    catch(__) { throw new Error('Verification video could not be decoded. Record again using the portal camera.'); }
  }
}

function uploadRegistrationVideo_(p) {
  const hash=hexDigest_(String(p.registration_token||''));
  const reg=getRows_(TABS.REGISTRATIONS).find(x=>x.token_hash===hash && String(x.used)!=='TRUE');
  if(!reg || new Date(reg.expires_at)<=new Date()) throw new Error('Registration video session expired. Please restart registration.');

  const user=getRows_(TABS.USERS).find(x=>x.user_id===reg.user_id);
  const customer=getRows_(TABS.CUSTOMERS).find(x=>x.customer_id===reg.customer_id);
  const kyc=getRows_(TABS.KYC).find(x=>x.customer_id===reg.customer_id);
  if(!user || !customer || !kyc) throw new Error('Registration record is incomplete.');

  const folderId=PropertiesService.getScriptProperties().getProperty(SARKSH.PROP_KYC_FOLDER_ID);
  if(!folderId) throw new Error('KYC storage is not configured.');
  const bytes=decodeBase64Safe_(p.file_base64);
  if(!bytes.length) throw new Error('Empty verification video.');
  if(bytes.length>SARKSH.VIDEO_MAX_BYTES) throw new Error('Verification video exceeds the 3 MB onboarding limit.');
  const mime=String(p.mime_type||'video/webm');
  if(!/^video\//.test(mime)) throw new Error('Invalid verification video format.');

  const file=DriveApp.getFolderById(folderId).createFile(
    Utilities.newBlob(bytes,mime,customer.customer_id+'_'+Date.now()+'.webm')
  );

  withWriteLock_(()=>{
    updateRowUnlocked_(TABS.KYC,kyc.__row,{
      video_file_id:file.getId(),video_view_url:file.getUrl(),status:'PENDING',submitted_at:now_()
    });
    updateRowUnlocked_(TABS.CUSTOMERS,customer.__row,{
      kyc_status:'PENDING',account_status:'PENDING_KYC',updated_at:now_()
    });
    updateRowUnlocked_(TABS.USERS,user.__row,{status:'ACTIVE'});
    updateRowUnlocked_(TABS.REGISTRATIONS,reg.__row,{used:'TRUE'});
  });

  audit_(user.user_id,'CUSTOMER','REGISTRATION_VIDEO_UPLOAD','CUSTOMER',customer.customer_id,'SUCCESS',file.getId());
  return {ok:true,customer_id:customer.customer_id};
}


function registrationResumeStatus_(p) {
  const reg=registrationByToken_(p.registration_token);
  const k=getRows_(TABS.KYC).find(x=>x.customer_id===reg.customer_id)||{};
  const docs=safeCustomerDocs_(reg.customer_id,false);
  const hasPan=docs.some(d=>d.document_type==='PAN_CARD');
  const hasAadhaarDoc=docs.some(d=>d.document_type==='AADHAAR');
  const hasAadhaarNumber=Boolean(k.aadhaar_hmac);
  const ready=hasPan && (hasAadhaarDoc || hasAadhaarNumber);
  const meet=getRows_(TABS.KYC_LIVE).filter(x=>x.customer_id===reg.customer_id && ['WAITING_AGENT','AGENT_JOINING','MEET_PENDING','MEET_READY','LIVE'].includes(String(x.status))).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]||null;
  return {ok:true,customer_id:reg.customer_id,documents:docs,ready_for_queue:ready,
    queue_requirement:ready?'':'Upload PAN Card and either provide Aadhaar number or upload Aadhaar document.',
    aadhaar_masked:k.aadhaar_masked||'',meet:meet?{session_id:meet.session_id,status:meet.status,meet_url:meet.meet_url||''}:null};
}
function uploadRegistrationDocument_(p) {
  const reg=registrationByToken_(p.registration_token);
  const file=saveKycDocument_(reg.customer_id,p.document_type,p.file_name,p.mime_type,p.file_base64,reg.user_id,'');
  audit_(reg.user_id,'CUSTOMER','KYC_DOCUMENT_UPLOAD','CUSTOMER',reg.customer_id,'SUCCESS',String(p.document_type||''));
  return {ok:true,file_id:file.getId()};
}

function loginCustomer_(p) {
  const identifier=String(p.identifier||'').trim().toLowerCase(), password=String(p.password||'');
  const user=getRows_(TABS.USERS).find(x =>
    normalizeEmail_(x.email)===identifier || String(x.customer_id).toLowerCase()===identifier
  );
  if(!user || String(user.status)!=='ACTIVE' || hashPassword_(password,user.password_salt)!==String(user.password_hash)) {
    audit_(identifier,'CUSTOMER','LOGIN','CUSTOMER',identifier,'FAILED','');
    throw new Error('Invalid login credentials.');
  }
  const token=makeSession_(user.user_id,'CUSTOMER');
  updateRow_(TABS.USERS,user.__row,{last_login:now_()});
  audit_(user.user_id,'CUSTOMER','LOGIN','CUSTOMER',user.customer_id,'SUCCESS','');
  return {ok:true,token};
}

/* =========================================================
   FINANCIAL CALCULATION
   ========================================================= */
function metricsForCustomer_(customerId) {
  const trades=getRows_(TABS.TRADES).filter(x=>x.customer_id===customerId);
  const closed=trades.filter(x=>String(x.status)==='CLOSED');
  const ledger=getRows_(TABS.LEDGER).filter(x=>x.customer_id===customerId);
  const netPnl=closed.reduce((a,x)=>a+Number(x.net_pnl||0),0);
  const currentAmount=ledger.reduce((a,x)=>a+Number(x.signed_amount||0),0);
  const amountPlaced=ledger.filter(x=>['OPENING_BALANCE','CREDIT','DEBIT','WITHDRAWAL'].includes(String(x.type))).reduce((a,x)=>a+Number(x.signed_amount||0),0);
  const wins=closed.filter(x=>Number(x.net_pnl)>0).length;
  const losses=closed.filter(x=>Number(x.net_pnl)<0).length;
  return {
    amount_placed:amountPlaced,
    current_amount:currentAmount,
    net_pnl:netPnl,
    total_trades:trades.length,
    winning_trades:wins,
    losing_trades:losses,
    win_rate:closed.length ? wins/closed.length*100 : 0
  };
}

function customerDashboard_(p) {
  const ctx=customerContext_(p.token), c=ctx.customer;
  const metrics=metricsForCustomer_(c.customer_id);
  const recent=getRows_(TABS.TRADES).filter(x=>x.customer_id===c.customer_id)
    .sort((a,b)=>String(b.trade_date).localeCompare(String(a.trade_date))).slice(0,8);
  const performance=getRows_(TABS.LEDGER).filter(x=>x.customer_id===c.customer_id)
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)))
    .reduce((arr,x)=>{arr.push((arr.length?arr[arr.length-1]:0)+Number(x.signed_amount||0));return arr;},[])
    .slice(-30);
  const settings=getRows_(TABS.CUSTOMER_PREFS).find(x=>x.customer_id===c.customer_id)||{};
  return {
    ok:true,
    customer:{full_name:c.full_name,account_status:c.account_status,kyc_status:c.kyc_status},
    settings:{preferred_name:settings.preferred_name||'',compact_dashboard:String(settings.compact_dashboard||'FALSE'),show_trade_quality:String(settings.show_trade_quality||'TRUE')},
    metrics,recent_trades:recent,performance
  };
}

function customerTrades_(p) {
  const c=customerContext_(p.token).customer;
  return {ok:true,trades:getRows_(TABS.TRADES).filter(x=>x.customer_id===c.customer_id)
    .sort((a,b)=>String(b.trade_date).localeCompare(String(a.trade_date)))};
}

/* =========================================================
   KYC
   ========================================================= */

function getKycCenter_(p) {
  const ctx=customerContext_(p.token),c=ctx.customer;
  const k=getRows_(TABS.KYC).find(x=>x.customer_id===c.customer_id)||null;
  const meet=getRows_(TABS.KYC_LIVE).filter(x=>x.customer_id===c.customer_id && ['WAITING_AGENT','AGENT_JOINING','MEET_PENDING','MEET_READY','LIVE'].includes(String(x.status))).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]||null;
  return {ok:true,kyc:k,documents:safeCustomerDocs_(c.customer_id,false),meet:meet?{session_id:meet.session_id,status:meet.status,meet_url:resolveStoredMeet_(meet)}:null};
}
function uploadCustomerDocument_(p) {
  const ctx=customerContext_(p.token);
  const file=saveKycDocument_(ctx.customer.customer_id,p.document_type,p.file_name,p.mime_type,p.file_base64,ctx.user.user_id,p.reference||'');
  audit_(ctx.user.user_id,'CUSTOMER','KYC_DOCUMENT_UPLOAD','CUSTOMER',ctx.customer.customer_id,'SUCCESS',String(p.document_type||''));
  return {ok:true,file_id:file.getId()};
}
function requestCustomerMeetKyc_(p) {
  const ctx=customerContext_(p.token),c=ctx.customer;
  const active=getRows_(TABS.KYC_LIVE).filter(x=>x.customer_id===c.customer_id && ['WAITING_AGENT','AGENT_JOINING','MEET_PENDING','MEET_READY','LIVE'].includes(String(x.status)))[0];
  if(active)return {ok:true,session_id:active.session_id};
  const k=getRows_(TABS.KYC).find(x=>x.customer_id===c.customer_id)||{};
  const docs=safeCustomerDocs_(c.customer_id,false);
  if(!docs.some(d=>d.document_type==='PAN_CARD'))throw new Error('Upload PAN Card before requesting live KYC.');
  if(!k.aadhaar_hmac && !docs.some(d=>d.document_type==='AADHAAR'))throw new Error('Provide Aadhaar number or upload Aadhaar document before live KYC.');
  const sid=makeId_('LKY');
  appendRow_(TABS.KYC_LIVE,{session_id:sid,customer_id:c.customer_id,user_id:ctx.user.user_id,registration_id:'EXISTING_CUSTOMER',status:'WAITING_AGENT',assigned_agent_id:'',meet_url:'',calendar_event_id:'',scheduled_start:'',scheduled_end:'',meet_created_at:'',created_at:now_(),accepted_at:'',started_at:'',ended_at:'',result:'',remarks:''});
  updateRow_(TABS.CUSTOMERS,c.__row,{kyc_status:'WAITING_AGENT',updated_at:now_()});
  return {ok:true,session_id:sid};
}
function customerMeetKycStatus_(p) {
  const ctx=customerContext_(p.token),c=ctx.customer;
  const meet=getRows_(TABS.KYC_LIVE).filter(x=>x.customer_id===c.customer_id && ['WAITING_AGENT','AGENT_JOINING','MEET_PENDING','MEET_READY','LIVE'].includes(String(x.status))).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]||null;
  return {ok:true,meet:meet?{session_id:meet.session_id,status:meet.status,meet_url:resolveStoredMeet_(meet)}:null};
}

function getKyc_(p) {
  const c=customerContext_(p.token).customer;
  const k=getRows_(TABS.KYC).find(x=>x.customer_id===c.customer_id);
  return {ok:true,kyc:k||null};
}

function submitKyc_(p) {
  const ctx=customerContext_(p.token), c=ctx.customer;
  const pan=String(p.pan||'').toUpperCase().trim();
  const aadhaar=aadhaarReference_(p.aadhaar_number);
  if(pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new Error('PAN format is invalid.');

  const existing=getRows_(TABS.KYC).find(x=>x.customer_id===c.customer_id);
  const patch={
    customer_id:c.customer_id,pan,dob:String(p.dob||''),address:String(p.address||''),
    identity_ref:String(p.identity_ref||''),aadhaar_masked:aadhaar.masked||existing?.aadhaar_masked||'',aadhaar_hmac:aadhaar.hmac||existing?.aadhaar_hmac||'',aadhaar_mode:aadhaar.mode||existing?.aadhaar_mode||'',status:'PENDING',submitted_at:now_(),
    reviewed_at:'',reviewed_by:'',remarks:''
  };
  if(existing) updateRow_(TABS.KYC,existing.__row,patch);
  else appendRow_(TABS.KYC,{kyc_id:makeId_('KYC'),...patch,video_file_id:'',video_view_url:''});

  updateRow_(TABS.CUSTOMERS,c.__row,{
    dob:String(p.dob||''),pan_ref:pan?('PAN-****'+pan.slice(-4)):'',
    address:String(p.address||''),kyc_status:'PENDING',updated_at:now_()
  });
  audit_(ctx.user.user_id,'CUSTOMER','KYC_SUBMIT','CUSTOMER',c.customer_id,'SUCCESS','');
  return {ok:true};
}

function uploadKycVideo_(p) {
  const ctx=customerContext_(p.token), c=ctx.customer;
  const folderId=PropertiesService.getScriptProperties().getProperty(SARKSH.PROP_KYC_FOLDER_ID);
  if(!folderId) throw new Error('KYC storage is not configured.');

  const bytes=Utilities.base64Decode(String(p.file_base64||''));
  if(!bytes.length) throw new Error('Empty video.');
  if(bytes.length>SARKSH.VIDEO_MAX_BYTES) throw new Error('Video exceeds MVP upload limit.');
  const mime=String(p.mime_type||'video/webm');
  if(!/^video\//.test(mime)) throw new Error('Invalid video format.');

  const file=DriveApp.getFolderById(folderId).createFile(
    Utilities.newBlob(bytes,mime,c.customer_id+'_'+Date.now()+'.webm')
  );
  const existing=getRows_(TABS.KYC).find(x=>x.customer_id===c.customer_id);
  const patch={video_file_id:file.getId(),video_view_url:file.getUrl(),status:'PENDING',submitted_at:now_()};
  if(existing) updateRow_(TABS.KYC,existing.__row,patch);
  else appendRow_(TABS.KYC,{
    kyc_id:makeId_('KYC'),customer_id:c.customer_id,pan:'',dob:'',address:'',identity_ref:'',
    status:'PENDING',submitted_at:now_(),reviewed_at:'',reviewed_by:'',remarks:'',
    video_file_id:file.getId(),video_view_url:file.getUrl()
  });
  audit_(ctx.user.user_id,'CUSTOMER','KYC_VIDEO_UPLOAD','CUSTOMER',c.customer_id,'SUCCESS',file.getId());
  return {ok:true,file_id:file.getId()};
}


function customerSettingsGet_(p) {
  const ctx=customerContext_(p.token),c=ctx.customer;
  const s=getRows_(TABS.CUSTOMER_PREFS).find(x=>x.customer_id===c.customer_id)||{};
  return {ok:true,customer:{full_name:c.full_name,email:c.email,mobile:c.mobile,address:c.address,account_status:c.account_status},
    settings:{preferred_name:s.preferred_name||'',email_notifications:String(s.email_notifications||'TRUE'),trade_notifications:String(s.trade_notifications||'FALSE'),compact_dashboard:String(s.compact_dashboard||'FALSE'),show_trade_quality:String(s.show_trade_quality||'TRUE')}};
}
function customerSettingsSave_(p) {
  const ctx=customerContext_(p.token),c=ctx.customer;
  const mobile=String(p.mobile||'').trim();if(!/^\d{10,15}$/.test(mobile))throw new Error('Valid mobile number is required.');
  updateRow_(TABS.CUSTOMERS,c.__row,{mobile,address:String(p.address||''),updated_at:now_()});
  const patch={customer_id:c.customer_id,preferred_name:String(p.preferred_name||'').trim(),email_notifications:p.email_notifications?'TRUE':'FALSE',trade_notifications:p.trade_notifications?'TRUE':'FALSE',compact_dashboard:p.compact_dashboard?'TRUE':'FALSE',show_trade_quality:p.show_trade_quality?'TRUE':'FALSE',updated_at:now_()};
  const existing=getRows_(TABS.CUSTOMER_PREFS).find(x=>x.customer_id===c.customer_id);
  if(existing)updateRow_(TABS.CUSTOMER_PREFS,existing.__row,patch);else appendRow_(TABS.CUSTOMER_PREFS,patch);
  audit_(ctx.user.user_id,'CUSTOMER','SETTINGS_UPDATE','CUSTOMER',c.customer_id,'SUCCESS','');
  return {ok:true};
}
function customerChangePassword_(p) {
  const ctx=customerContext_(p.token),u=ctx.user;
  if(hashPassword_(String(p.current_password||''),u.password_salt)!==String(u.password_hash))throw new Error('Current password is incorrect.');
  const np=String(p.new_password||'');if(np.length<8)throw new Error('New password must be at least 8 characters.');
  const salt=newSalt_();updateRow_(TABS.USERS,u.__row,{password_hash:hashPassword_(np,salt),password_salt:salt});
  getRows_(TABS.SESSIONS).filter(x=>x.user_id===u.user_id && x.session_id!==ctx.session.session_id && String(x.revoked)!=='TRUE').forEach(s=>updateRow_(TABS.SESSIONS,s.__row,{revoked:'TRUE'}));
  audit_(u.user_id,'CUSTOMER','PASSWORD_CHANGE','CUSTOMER',u.customer_id,'SUCCESS','');
  return {ok:true};
}
function customerTeam_(p) {
  const ctx=customerContext_(p.token);
  const team=getRows_(TABS.CUSTOMER_TEAM).filter(x=>x.customer_id===ctx.customer.customer_id && String(x.status||'ACTIVE')==='ACTIVE');
  return {ok:true,team};
}

/* =========================================================
   ADMIN AUTH: PASSWORD + EMAIL OTP + GOOGLE AUTHENTICATOR
   ========================================================= */
function adminLoginStart_(p) {
  const email=normalizeEmail_(p.email), password=String(p.password||'');
  const admin=getRows_(TABS.ADMINS).find(x=>normalizeEmail_(x.email)===email && String(x.status)==='ACTIVE');
  if(!admin) { audit_(email,'ADMIN','LOGIN_PASSWORD','ADMIN',email,'FAILED','Unknown/inactive admin'); throw new Error('Invalid admin credentials.'); }
  if(admin.locked_until && new Date(admin.locked_until)>new Date()) throw new Error('Admin login is temporarily locked. Try again later.');
  if(hashPassword_(password,admin.password_salt)!==String(admin.password_hash)) {
    const failed=Number(admin.failed_attempts||0)+1;
    const patch={failed_attempts:failed};
    if(failed>=5) patch.locked_until=new Date(Date.now()+15*60000).toISOString();
    updateRow_(TABS.ADMINS,admin.__row,patch);
    audit_(admin.admin_id,admin.role,'LOGIN_PASSWORD','ADMIN',admin.admin_id,'FAILED','Password mismatch');
    throw new Error(failed>=5?'Too many failed attempts. Login locked for 15 minutes.':'Invalid admin credentials.');
  }
  updateRow_(TABS.ADMINS,admin.__row,{failed_attempts:0,locked_until:''});
  const challenge=createAdminChallenge_(admin);
  audit_(admin.admin_id,admin.role,'LOGIN_PASSWORD','ADMIN',admin.admin_id,'SUCCESS','OTP dispatched');
  return {ok:true,challenge_id:challenge.challengeId,masked_email:maskEmail_(challenge.email)};
}
function adminVerifyEmailOtp_(p) {
  const c=challenge_(p.challenge_id,['PASSWORD_VERIFIED']);
  const expected=String(c.otp_hash), actual=hexDigest_(c.challenge_id+':'+String(p.otp||'').trim());
  if(actual!==expected) {
    updateRow_(TABS.AUTH,c.__row,{attempts:Number(c.attempts||0)+1});
    audit_(c.admin_id,'ADMIN','LOGIN_EMAIL_OTP','AUTH_CHALLENGE',c.challenge_id,'FAILED','');
    throw new Error('Invalid email OTP.');
  }
  const admin=getRows_(TABS.ADMINS).find(x=>x.admin_id===c.admin_id && String(x.status)==='ACTIVE');
  if(!admin) throw new Error('Admin account is not active.');
  let secret=String(admin.totp_secret||'');
  const enabled=String(admin.totp_enabled)==='TRUE';
  if(!secret) { secret=generateTotpSecret_(); updateRow_(TABS.ADMINS,admin.__row,{totp_secret:secret,totp_enabled:'FALSE'}); }
  updateRow_(TABS.AUTH,c.__row,{stage:'EMAIL_VERIFIED',attempts:0,expires_at:new Date(Date.now()+SARKSH.AUTH_CHALLENGE_MINUTES*60000).toISOString()});
  audit_(admin.admin_id,admin.role,'LOGIN_EMAIL_OTP','AUTH_CHALLENGE',c.challenge_id,'SUCCESS','');
  const label='SARKSH Admin ('+admin.email+')';
  return {ok:true,enrollment_required:!enabled,manual_key:!enabled?secret:'',account_name:label};
}
function adminVerifyTotp_(p) {
  const c=challenge_(p.challenge_id,['EMAIL_VERIFIED']);
  const admin=getRows_(TABS.ADMINS).find(x=>x.admin_id===c.admin_id && String(x.status)==='ACTIVE');
  if(!admin) throw new Error('Admin account is not active.');
  const secret=String(admin.totp_secret||'');
  if(!secret||!verifyTotp_(secret,p.totp)) {
    updateRow_(TABS.AUTH,c.__row,{attempts:Number(c.attempts||0)+1});
    audit_(admin.admin_id,admin.role,'LOGIN_TOTP','AUTH_CHALLENGE',c.challenge_id,'FAILED','');
    throw new Error('Invalid Google Authenticator code.');
  }
  updateRow_(TABS.AUTH,c.__row,{stage:'COMPLETE',used:'TRUE'});
  if(String(admin.totp_enabled)!=='TRUE') updateRow_(TABS.ADMINS,admin.__row,{totp_enabled:'TRUE'});
  const token=makeSession_(admin.admin_id,'ADMIN');
  updateRow_(TABS.ADMINS,admin.__row,{last_login:now_(),failed_attempts:0,locked_until:''});
  audit_(admin.admin_id,admin.role,'LOGIN_3FA','ADMIN',admin.admin_id,'SUCCESS','Password + email OTP + TOTP');
  return {ok:true,token,role:admin.role};
}

/* =========================================================
   ADMIN DASHBOARD / CUSTOMER 360
   ========================================================= */
function adminDashboard_(p) {
  const admin=requireAdmin_(p.token);
  const customers=getRows_(TABS.CUSTOMERS), trades=getRows_(TABS.TRADES), kyc=getRows_(TABS.KYC);
  const pending=kyc.filter(x=>String(x.status)==='PENDING').length;
  const pnl=trades.filter(x=>String(x.status)==='CLOSED').reduce((a,x)=>a+Number(x.net_pnl||0),0);
  const audit=getRows_(TABS.AUDIT);
  const since=new Date(Date.now()-86400000);
  const failed=audit.filter(x=>x.action==='LOGIN'&&x.result==='FAILED'&&new Date(x.timestamp)>since).length;
  const alerts=[];
  if(pending) alerts.push({level:'',message:pending+' KYC submissions require review.'});
  if(failed>=5) alerts.push({level:'danger',message:failed+' failed login attempts detected in the last 24 hours.'});
  return {
    ok:true,admin:{admin_id:admin.admin_id,role:admin.role},
    metrics:{total_customers:customers.length,pending_kyc:pending,total_trades:trades.length,net_pnl:pnl},
    alerts,recent_audit:audit.slice(-12).reverse()
  };
}

function adminCustomers_(p) {
  requireAdmin_(p.token);
  return {ok:true,customers:getRows_(TABS.CUSTOMERS).map(c=>({...c,...metricsForCustomer_(c.customer_id)}))};
}
function adminCustomerDetail_(p) {
  requireAdmin_(p.token);
  const c=getRows_(TABS.CUSTOMERS).find(x=>x.customer_id===String(p.customer_id||''));
  if(!c) throw new Error('Customer not found.');
  return {ok:true,customer:c,metrics:metricsForCustomer_(c.customer_id)};
}
function adminCustomerDashboard_(p) {
  requireAdmin_(p.token);
  const c=getRows_(TABS.CUSTOMERS).find(x=>x.customer_id===String(p.customer_id||''));
  if(!c) throw new Error('Customer not found.');
  const trades=getRows_(TABS.TRADES).filter(x=>x.customer_id===c.customer_id).sort((a,b)=>String(b.trade_date).localeCompare(String(a.trade_date)));
  const ledger=getRows_(TABS.LEDGER).filter(x=>x.customer_id===c.customer_id).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const kyc=getRows_(TABS.KYC).find(x=>x.customer_id===c.customer_id)||null;
  const consent=getRows_(TABS.CONSENTS).filter(x=>x.customer_id===c.customer_id).slice(-1)[0]||null;
  const documents=safeCustomerDocs_(c.customer_id,true);
  const team=getRows_(TABS.CUSTOMER_TEAM).filter(x=>x.customer_id===c.customer_id && String(x.status||'ACTIVE')==='ACTIVE');
  return {ok:true,customer:c,metrics:metricsForCustomer_(c.customer_id),trades,ledger,kyc,consent,documents,team};
}


/* =========================================================
   LIVE KYC / WEBRTC SIGNALLING
   ========================================================= */
function registrationByToken_(token) {
  const hash=hexDigest_(String(token||''));
  const reg=getRows_(TABS.REGISTRATIONS).find(x=>x.token_hash===hash && String(x.used)!=='TRUE');
  if(!reg || new Date(reg.expires_at)<=new Date()) throw new Error('Registration verification session expired.');
  return reg;
}
function liveSessionForCustomer_(sessionId,reg) {
  const s=getRows_(TABS.KYC_LIVE).find(x=>x.session_id===String(sessionId||'') && x.customer_id===reg.customer_id);
  if(!s) throw new Error('Live KYC session not found.');
  return s;
}
function createLiveKycSession_(p) {
  const reg=registrationByToken_(p.registration_token);
  const kyc=getRows_(TABS.KYC).find(x=>x.customer_id===reg.customer_id)||{};
  const docs=safeCustomerDocs_(reg.customer_id,false);
  if(!docs.some(d=>d.document_type==='PAN_CARD')) throw new Error('PAN Card must be uploaded before joining KYC queue.');
  if(!kyc.aadhaar_hmac && !docs.some(d=>d.document_type==='AADHAAR')) throw new Error('Provide Aadhaar number or upload Aadhaar document before joining KYC queue.');
  const existing=getRows_(TABS.KYC_LIVE)
    .filter(x=>x.customer_id===reg.customer_id)
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];

  if(existing && ['WAITING_AGENT','AGENT_JOINING','LIVE'].includes(String(existing.status))) {
    return {ok:true,session_id:existing.session_id,status:existing.status};
  }
  if(existing && String(existing.status)==='COMPLETED' && String(existing.result)!=='RESUBMIT') {
    throw new Error('Live KYC has already been completed.');
  }

  const sessionId=makeId_('LKY');
  appendRow_(TABS.KYC_LIVE,{
    session_id:sessionId,customer_id:reg.customer_id,user_id:reg.user_id,registration_id:reg.registration_id,
    status:'WAITING_AGENT',assigned_agent_id:'',meet_url:'',calendar_event_id:'',scheduled_start:'',scheduled_end:'',meet_created_at:'',created_at:now_(),accepted_at:'',started_at:'',ended_at:'',
    result:'',remarks:''
  });
  updateRow_(TABS.REGISTRATIONS,reg.__row,{status:'WAITING_AGENT',live_kyc_session_id:sessionId});
  const c=getRows_(TABS.CUSTOMERS).find(x=>x.customer_id===reg.customer_id);
  if(c) updateRow_(TABS.CUSTOMERS,c.__row,{kyc_status:'WAITING_AGENT',updated_at:now_()});
  const k=getRows_(TABS.KYC).find(x=>x.customer_id===reg.customer_id);
  if(k) updateRow_(TABS.KYC,k.__row,{status:'WAITING_AGENT',submitted_at:now_()});
  audit_(reg.user_id,'CUSTOMER','LIVE_KYC_QUEUE_JOIN','CUSTOMER',reg.customer_id,'SUCCESS',sessionId);
  return {ok:true,session_id:sessionId,status:'WAITING_AGENT'};
}
function liveKycStatus_(p) {
  const reg=registrationByToken_(p.registration_token);
  const s=liveSessionForCustomer_(p.session_id,reg);
  const waiting=getRows_(TABS.KYC_LIVE)
    .filter(x=>String(x.status)==='WAITING_AGENT')
    .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  const pos=Math.max(1,waiting.findIndex(x=>x.session_id===s.session_id)+1);
  return {ok:true,session:{
    session_id:s.session_id,status:s.status,result:s.result||'',remarks:s.remarks||'',meet_url:resolveStoredMeet_(s)
  },queue_position:String(s.status)==='WAITING_AGENT'?pos:0};
}
function authorizeLiveParticipant_(p) {
  const participant=String(p.participant||'').toUpperCase();
  if(participant==='CUSTOMER'){
    const reg=registrationByToken_(p.registration_token);
    const session=liveSessionForCustomer_(p.session_id,reg);
    return {participant,session,actor_id:reg.user_id,role:'CUSTOMER'};
  }
  if(participant==='AGENT'){
    const admin=requireAdmin_(p.token,['SUPER_ADMIN','OPERATIONS_ADMIN','KYC_ADMIN','KYC_AGENT']);
    const session=getRows_(TABS.KYC_LIVE).find(x=>x.session_id===String(p.session_id||''));
    if(!session) throw new Error('Live KYC session not found.');
    if(session.assigned_agent_id && session.assigned_agent_id!==admin.admin_id && admin.role!=='SUPER_ADMIN')
      throw new Error('This live KYC session is assigned to another agent.');
    return {participant,session,actor_id:admin.admin_id,role:admin.role};
  }
  throw new Error('Invalid live KYC participant.');
}
function liveKycSignalSend_(p) {
  const auth=authorizeLiveParticipant_(p);
  const type=String(p.type||'').toUpperCase();
  if(!['OFFER','ANSWER','ICE'].includes(type)) throw new Error('Invalid WebRTC signal type.');
  const payload=String(p.payload_json||'');
  if(!payload || payload.length>30000) throw new Error('Invalid WebRTC signal payload.');
  const seq=Date.now()*1000+Math.floor(Math.random()*1000);
  appendRow_(TABS.KYC_SIGNAL,{
    signal_id:makeId_('SIG'),session_id:auth.session.session_id,sender:auth.participant,
    seq,type,payload_json:payload,created_at:now_()
  });
  return {ok:true,seq};
}
function liveKycSignalPoll_(p) {
  const auth=authorizeLiveParticipant_(p);
  const after=Number(p.after_seq||0);
  const other=auth.participant==='CUSTOMER'?'AGENT':'CUSTOMER';
  const signals=getRows_(TABS.KYC_SIGNAL)
    .filter(x=>x.session_id===auth.session.session_id && String(x.sender)===other && Number(x.seq)>after)
    .sort((a,b)=>Number(a.seq)-Number(b.seq))
    .map(x=>({seq:Number(x.seq),type:x.type,payload_json:x.payload_json}));
  return {ok:true,signals};
}
function agentLiveKycQueue_(p) {
  const admin=requireAdmin_(p.token,['SUPER_ADMIN','OPERATIONS_ADMIN','KYC_ADMIN','KYC_AGENT']);
  const customers=getRows_(TABS.CUSTOMERS), kycs=getRows_(TABS.KYC);
  const nowMs=Date.now();
  const sessions=getRows_(TABS.KYC_LIVE)
    .filter(x=>['WAITING_AGENT','AGENT_JOINING','LIVE'].includes(String(x.status)))
    .filter(x=>!x.assigned_agent_id || x.assigned_agent_id===admin.admin_id || admin.role==='SUPER_ADMIN')
    .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))
    .map(s=>{
      const c=customers.find(x=>x.customer_id===s.customer_id)||{};
      const k=kycs.find(x=>x.customer_id===s.customer_id)||{};
      const pan=String(k.pan||'');
      return {
        session_id:s.session_id,customer_id:s.customer_id,full_name:c.full_name||'',email:c.email||'',
        status:s.status,pan_masked:pan?('PAN ****'+pan.slice(-4)):'',aadhaar_masked:k.aadhaar_masked||'',wait_minutes:Math.max(0,Math.floor((nowMs-new Date(s.created_at).getTime())/60000))
      };
    });
  return {ok:true,sessions};
}
function agentAcceptLiveKyc_(p) {
  const admin=requireAdmin_(p.token,['SUPER_ADMIN','OPERATIONS_ADMIN','KYC_ADMIN','KYC_AGENT']);
  const s=getRows_(TABS.KYC_LIVE).find(x=>x.session_id===String(p.session_id||''));
  if(!s) throw new Error('Live KYC session not found.');
  if(s.assigned_agent_id && s.assigned_agent_id!==admin.admin_id && admin.role!=='SUPER_ADMIN')
    throw new Error('Another agent already accepted this customer.');

  if(String(s.status)==='WAITING_AGENT'){
    updateRow_(TABS.KYC_LIVE,s.__row,{assigned_agent_id:admin.admin_id,status:'AGENT_JOINING',accepted_at:now_()});
  } else if(!['AGENT_JOINING','LIVE'].includes(String(s.status))) {
    throw new Error('This live KYC session is no longer available.');
  }

  const c=getRows_(TABS.CUSTOMERS).find(x=>x.customer_id===s.customer_id)||{};
  const k=getRows_(TABS.KYC).find(x=>x.customer_id===s.customer_id)||{};
  const consent=getRows_(TABS.CONSENTS).filter(x=>x.customer_id===s.customer_id).slice(-1)[0]||{};
  const pan=String(k.pan||'');
  const documents=safeCustomerDocs_(s.customer_id,true);
  audit_(admin.admin_id,admin.role,'LIVE_KYC_ACCEPT','CUSTOMER',s.customer_id,'SUCCESS',s.session_id);
  return {ok:true,customer:{
    customer_id:s.customer_id,full_name:c.full_name||'',email:c.email||'',mobile:c.mobile||'',
    pan_masked:pan?('PAN ****'+pan.slice(-4)):'',aadhaar_masked:k.aadhaar_masked||'',dob:k.dob||'',address:k.address||'',
    agreement_version:consent.agreement_version||''
  },documents,meet_url:resolveStoredMeet_(s)};
}

function resolveStoredMeet_(session) {
  if(!session)return '';
  if(session.meet_url)return String(session.meet_url);
  if(!session.calendar_event_id)return '';
  try{
    const ev=Calendar.Events.get('primary',String(session.calendar_event_id));
    const url=ev.hangoutLink || (((ev.conferenceData||{}).entryPoints||[]).find(x=>x.entryPointType==='video')||{}).uri || '';
    if(url && session.__row) updateRow_(TABS.KYC_LIVE,session.__row,{meet_url:url,status:'MEET_READY'});
    return url;
  }catch(_){return '';}
}
function grantAgentDocAccess_(customerId,email) {
  if(!email)return;
  getRows_(TABS.KYC_DOCS).filter(x=>x.customer_id===customerId && x.file_id).forEach(d=>{try{DriveApp.getFileById(d.file_id).addViewer(email);}catch(_){}});
}
function createGoogleMeet_(customer,admin,session) {
  const start=new Date(Date.now()+60*1000),end=new Date(start.getTime()+30*60*1000);
  const event={
    summary:'SARKSH KYC Verification - '+customer.customer_id,
    description:'Secure KYC verification session for SARKSH customer '+customer.customer_id+'. Do not include identity numbers in the Calendar event.',
    start:{dateTime:start.toISOString(),timeZone:SARKSH.TIMEZONE},
    end:{dateTime:end.toISOString(),timeZone:SARKSH.TIMEZONE},
    attendees:[{email:String(customer.email)},{email:String(admin.email)}],
    conferenceData:{createRequest:{requestId:Utilities.getUuid(),conferenceSolutionKey:{type:'hangoutsMeet'}}}
  };
  let created=Calendar.Events.insert(event,'primary',{conferenceDataVersion:1,sendUpdates:'all'});
  let url=created.hangoutLink || (((created.conferenceData||{}).entryPoints||[]).find(x=>x.entryPointType==='video')||{}).uri || '';
  for(let i=0;!url && i<4;i++){Utilities.sleep(700);created=Calendar.Events.get('primary',created.id);url=created.hangoutLink || (((created.conferenceData||{}).entryPoints||[]).find(x=>x.entryPointType==='video')||{}).uri || '';}
  return {event_id:created.id,meet_url:url,start:start.toISOString(),end:end.toISOString()};
}
function agentCreateMeetKyc_(p) {
  const admin=requireAdmin_(p.token,['SUPER_ADMIN','OPERATIONS_ADMIN','KYC_ADMIN','KYC_AGENT']);
  const s=getRows_(TABS.KYC_LIVE).find(x=>x.session_id===String(p.session_id||''));
  if(!s)throw new Error('Live KYC session not found.');
  if(s.assigned_agent_id && s.assigned_agent_id!==admin.admin_id && admin.role!=='SUPER_ADMIN')throw new Error('Session is assigned to another agent.');
  const customer=getRows_(TABS.CUSTOMERS).find(x=>x.customer_id===s.customer_id);if(!customer)throw new Error('Customer not found.');
  const existing=resolveStoredMeet_(s);if(existing)return {ok:true,meet_url:existing};
  updateRow_(TABS.KYC_LIVE,s.__row,{assigned_agent_id:admin.admin_id,status:'MEET_PENDING',accepted_at:s.accepted_at||now_()});
  grantAgentDocAccess_(s.customer_id,admin.email);
  const meet=createGoogleMeet_(customer,admin,s);
  updateRow_(TABS.KYC_LIVE,s.__row,{meet_url:meet.meet_url,calendar_event_id:meet.event_id,scheduled_start:meet.start,scheduled_end:meet.end,meet_created_at:now_(),status:meet.meet_url?'MEET_READY':'MEET_PENDING'});
  if(meet.meet_url){
    try{MailApp.sendEmail({to:customer.email,subject:'SARKSH KYC Google Meet is ready',htmlBody:'<p>Your SARKSH live KYC verification is ready.</p><p><a href="'+meet.meet_url+'">Join Google Meet</a></p><p>Customer reference: '+customer.customer_id+'</p>'});}catch(_){}
  }
  audit_(admin.admin_id,admin.role,'KYC_MEET_CREATE','CUSTOMER',s.customer_id,'SUCCESS',meet.event_id);
  return {ok:true,meet_url:meet.meet_url,event_id:meet.event_id};
}

function agentMarkLiveKycConnected_(p) {
  const admin=requireAdmin_(p.token,['SUPER_ADMIN','OPERATIONS_ADMIN','KYC_ADMIN','KYC_AGENT']);
  const s=getRows_(TABS.KYC_LIVE).find(x=>x.session_id===String(p.session_id||''));
  if(!s) throw new Error('Live KYC session not found.');
  if(s.assigned_agent_id && s.assigned_agent_id!==admin.admin_id && admin.role!=='SUPER_ADMIN')
    throw new Error('Session is assigned to another agent.');
  updateRow_(TABS.KYC_LIVE,s.__row,{status:'LIVE',assigned_agent_id:admin.admin_id,started_at:s.started_at||now_()});
  return {ok:true};
}
function deleteLiveSignals_(sessionId) {
  const sh=sheet_(TABS.KYC_SIGNAL);
  const rows=sh.getDataRange().getValues();
  if(rows.length<2) return;
  const headers=rows[0].map(String), idx=headers.indexOf('session_id');
  if(idx<0) return;
  for(let r=rows.length-1;r>=1;r--){
    if(String(rows[r][idx])===String(sessionId)) sh.deleteRow(r+1);
  }
}
function agentCompleteLiveKyc_(p) {
  const admin=requireAdmin_(p.token,['SUPER_ADMIN','OPERATIONS_ADMIN','KYC_ADMIN','KYC_AGENT']);
  const result=String(p.result||'').toUpperCase();
  if(!['VERIFIED','RESUBMIT','REJECTED'].includes(result)) throw new Error('Invalid live KYC result.');
  const s=getRows_(TABS.KYC_LIVE).find(x=>x.session_id===String(p.session_id||''));
  if(!s) throw new Error('Live KYC session not found.');
  if(s.assigned_agent_id && s.assigned_agent_id!==admin.admin_id && admin.role!=='SUPER_ADMIN')
    throw new Error('Session is assigned to another agent.');

  const remarks=String(p.remarks||'').trim();
  if(result!=='VERIFIED' && !remarks) throw new Error('Remarks are required for re-verification or rejection.');

  const c=getRows_(TABS.CUSTOMERS).find(x=>x.customer_id===s.customer_id);
  const u=getRows_(TABS.USERS).find(x=>x.user_id===s.user_id);
  const k=getRows_(TABS.KYC).find(x=>x.customer_id===s.customer_id);
  const reg=getRows_(TABS.REGISTRATIONS).find(x=>x.registration_id===s.registration_id);

  withWriteLock_(()=>{
    updateRowUnlocked_(TABS.KYC_LIVE,s.__row,{
      status:'COMPLETED',ended_at:now_(),result,remarks,assigned_agent_id:admin.admin_id
    });
    if(k) updateRowUnlocked_(TABS.KYC,k.__row,{
      status:result==='VERIFIED'?'APPROVED':result,reviewed_at:now_(),reviewed_by:admin.admin_id,remarks
    });
    if(c) updateRowUnlocked_(TABS.CUSTOMERS,c.__row,{
      kyc_status:result==='VERIFIED'?'APPROVED':result,
      account_status:result==='VERIFIED'?'ACTIVE':(result==='RESUBMIT'?'KYC_RESUBMIT':'KYC_REJECTED'),
      updated_at:now_()
    });
    if(u) updateRowUnlocked_(TABS.USERS,u.__row,{
      status:result==='VERIFIED'?'ACTIVE':'PENDING_LIVE_KYC'
    });
    if(reg) updateRowUnlocked_(TABS.REGISTRATIONS,reg.__row,{
      used:result==='VERIFIED'?'TRUE':'FALSE',status:result,live_kyc_session_id:s.session_id
    });
  });
  deleteLiveSignals_(s.session_id);
  audit_(admin.admin_id,admin.role,'LIVE_KYC_COMPLETE','CUSTOMER',s.customer_id,'SUCCESS',
    JSON.stringify({result,remarks,session_id:s.session_id}));
  return {ok:true,result};
}

/* =========================================================
   ADMIN KYC
   ========================================================= */
function adminKycQueue_(p) {
  requireAdmin_(p.token,['SUPER_ADMIN','KYC_ADMIN','OPERATIONS_ADMIN','AUDITOR']);
  const customers=getRows_(TABS.CUSTOMERS);
  const items=getRows_(TABS.KYC).map(k=>({
    ...k,full_name:(customers.find(c=>c.customer_id===k.customer_id)||{}).full_name||''
  })).sort((a,b)=>String(b.submitted_at).localeCompare(String(a.submitted_at)));
  return {ok:true,items};
}
function reviewKyc_(p) {
  const admin=requireAdmin_(p.token,['SUPER_ADMIN','KYC_ADMIN','OPERATIONS_ADMIN']);
  const status=String(p.status||'');
  if(!['APPROVED','RESUBMIT','REJECTED'].includes(status)) throw new Error('Invalid KYC status.');
  const k=getRows_(TABS.KYC).find(x=>x.customer_id===String(p.customer_id||''));
  if(!k) throw new Error('KYC record not found.');
  updateRow_(TABS.KYC,k.__row,{status,reviewed_at:now_(),reviewed_by:admin.admin_id,remarks:String(p.remarks||'')});
  const c=getRows_(TABS.CUSTOMERS).find(x=>x.customer_id===k.customer_id);
  if(c) updateRow_(TABS.CUSTOMERS,c.__row,{
    kyc_status:status,account_status:status==='APPROVED'?'ACTIVE':'PENDING_KYC',updated_at:now_()
  });
  audit_(admin.admin_id,admin.role,'KYC_REVIEW','CUSTOMER',k.customer_id,'SUCCESS',status);
  return {ok:true};
}

/* =========================================================
   ADMIN TRADES / LEDGER
   ========================================================= */
function adminTrades_(p) {
  requireAdmin_(p.token);
  return {ok:true,trades:getRows_(TABS.TRADES).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,1000)};
}
function adminCreateTrade_(p) {
  const admin=requireAdmin_(p.token,['SUPER_ADMIN','TRADE_ADMIN','OPERATIONS_ADMIN']);
  const customerId=String(p.customer_id||'').trim();
  const customer=getRows_(TABS.CUSTOMERS).find(x=>x.customer_id===customerId);
  if(!customer) throw new Error('Customer ID not found.');

  const type=String(p.trade_type||'BUY').toUpperCase();
  const status=String(p.status||'CLOSED').toUpperCase();
  const quantity=Number(p.quantity), entry=Number(p.entry_price), exit=Number(p.exit_price||0), charges=Number(p.charges||0);
  if(!['BUY','SELL'].includes(type)) throw new Error('Invalid trade type.');
  if(!['OPEN','CLOSED'].includes(status)) throw new Error('Invalid trade status.');
  if(!(quantity>0) || !(entry>=0) || !(charges>=0)) throw new Error('Invalid trade values.');

  let gross=0, net=0;
  if(status==='CLOSED') {
    gross=(type==='SELL' ? (entry-exit) : (exit-entry))*quantity;
    net=gross-charges;
  }
  const tradeId=makeId_('TRD');
  const trade={
    trade_id:tradeId,customer_id:customerId,trade_date:String(p.trade_date||today_()),
    symbol:String(p.symbol||'').trim().toUpperCase(),exchange:String(p.exchange||'NSE').toUpperCase(),
    trade_type:type,quantity,entry_price:entry,exit_price:exit,gross_pnl:gross,charges,net_pnl:net,
    status,entered_by:admin.admin_id,created_at:now_(),updated_at:now_()
  };
  if(!trade.symbol) throw new Error('Symbol is required.');

  withWriteLock_(()=>{
    const tsh=sheet_(TABS.TRADES), th=tsh.getRange(1,1,1,tsh.getLastColumn()).getValues()[0].map(String);
    tsh.appendRow(th.map(k=>trade[k]===undefined?'':trade[k]));
    if(status==='CLOSED') {
      const ledger={
        transaction_id:makeId_('LED'),customer_id:customerId,date:trade.trade_date,type:'TRADE_PNL',
        amount:Math.abs(net),signed_amount:net,reference:tradeId,
        description:trade.symbol+' '+trade.trade_type+' net P&L',created_at:now_(),created_by:admin.admin_id
      };
      const lsh=sheet_(TABS.LEDGER), lh=lsh.getRange(1,1,1,lsh.getLastColumn()).getValues()[0].map(String);
      lsh.appendRow(lh.map(k=>ledger[k]===undefined?'':ledger[k]));
    }
  });
  audit_(admin.admin_id,admin.role,'TRADE_CREATE','TRADE',tradeId,'SUCCESS',
    JSON.stringify({customer_id:customerId,symbol:trade.symbol,net_pnl:net}));
  return {ok:true,trade};
}

function adminAccounts_(p) {
  requireAdmin_(p.token,['SUPER_ADMIN','OPERATIONS_ADMIN','AUDITOR']);
  const accounts=getRows_(TABS.CUSTOMERS).map(c=>({
    customer_id:c.customer_id,full_name:c.full_name,account_status:c.account_status,
    ...metricsForCustomer_(c.customer_id)
  }));
  return {ok:true,accounts};
}

function adminLedgerEntry_(p) {
  const admin=requireAdmin_(p.token,['SUPER_ADMIN','OPERATIONS_ADMIN']);
  const customerId=String(p.customer_id||'').trim();
  const customer=getRows_(TABS.CUSTOMERS).find(x=>x.customer_id===customerId);
  if(!customer) throw new Error('Customer ID not found.');
  const type=String(p.type||'').toUpperCase(), amount=Number(p.amount);
  if(!['OPENING_BALANCE','CREDIT','DEBIT','WITHDRAWAL','ADJUSTMENT'].includes(type)) throw new Error('Invalid ledger type.');
  if(!isFinite(amount) || amount===0) throw new Error('Invalid ledger amount.');
  let signed=amount;
  if(type==='OPENING_BALANCE'||type==='CREDIT') signed=Math.abs(amount);
  if(type==='DEBIT'||type==='WITHDRAWAL') signed=-Math.abs(amount);

  appendRow_(TABS.LEDGER,{
    transaction_id:makeId_('LED'),customer_id:customerId,date:today_(),type,
    amount:Math.abs(amount),signed_amount:signed,reference:'ADMIN',
    description:String(p.description||''),created_at:now_(),created_by:admin.admin_id
  });
  audit_(admin.admin_id,admin.role,'LEDGER_ENTRY','CUSTOMER',customerId,'SUCCESS',
    JSON.stringify({type,signed_amount:signed}));
  return {ok:true,current_amount:metricsForCustomer_(customerId).current_amount};
}

/* =========================================================
   ADMIN MONITOR / AUDIT / ADMIN USERS
   ========================================================= */
function adminMonitoring_(p) {
  requireAdmin_(p.token);
  const day=today_(), audit=getRows_(TABS.AUDIT), trades=getRows_(TABS.TRADES),
    customers=getRows_(TABS.CUSTOMERS), kyc=getRows_(TABS.KYC);
  const failed=audit.filter(x=>x.action==='LOGIN'&&x.result==='FAILED'&&String(x.timestamp).slice(0,10)===day).length;
  const success=audit.filter(x=>x.action==='LOGIN'&&x.result==='SUCCESS'&&String(x.timestamp).slice(0,10)===day).length;
  const pending=kyc.filter(x=>x.status==='PENDING').length;
  const alerts=[];
  if(pending) alerts.push({message:pending+' KYC records are pending review.'});
  if(failed>=5) alerts.push({level:'danger',message:'High failed-login count today: '+failed+'.'});
  return {
    ok:true,
    metrics:{
      registrations_today:customers.filter(x=>String(x.created_at).slice(0,10)===day).length,
      successful_logins:success,failed_logins:failed,
      trades_today:trades.filter(x=>String(x.trade_date).slice(0,10)===day).length
    },
    health:[
      {name:'Apps Script API',status:'ONLINE',detail:'Backend request completed.'},
      {name:'Google Sheets DB',status:'ONLINE',detail:customers.length+' customer records accessible.'},
      {name:'KYC Drive',status:PropertiesService.getScriptProperties().getProperty(SARKSH.PROP_KYC_FOLDER_ID)?'ONLINE':'CONFIGURE',detail:'Private storage reference.'}
    ],
    alerts
  };
}
function adminAudit_(p) {
  requireAdmin_(p.token,['SUPER_ADMIN','AUDITOR','OPERATIONS_ADMIN']);
  return {ok:true,logs:getRows_(TABS.AUDIT).slice(-1000).reverse()};
}
function adminListAdmins_(p) {
  requireAdmin_(p.token,['SUPER_ADMIN']);
  return {ok:true,admins:getRows_(TABS.ADMINS).map(a=>({
    admin_id:a.admin_id,name:a.name,email:a.email,role:a.role,status:a.status,
    created_at:a.created_at,last_login:a.last_login
  }))};
}
function adminCreateAdmin_(p) {
  const actor=requireAdmin_(p.token,['SUPER_ADMIN']);
  const email=normalizeEmail_(p.email), password=String(p.password||''), role=String(p.role||'');
  if(!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Valid email is required.');
  if(password.length<10) throw new Error('Password must be at least 10 characters.');
  if(!['SUPER_ADMIN','OPERATIONS_ADMIN','KYC_ADMIN','KYC_AGENT','TRADE_ADMIN','AUDITOR'].includes(role)) throw new Error('Invalid role.');
  if(getRows_(TABS.ADMINS).some(x=>normalizeEmail_(x.email)===email)) throw new Error('Admin email already exists.');
  const salt=newSalt_(), id=makeId_(SARKSH.ADMIN_PREFIX);
  appendRow_(TABS.ADMINS,{
    admin_id:id,name:String(p.name||'Administrator'),email,
    password_hash:hashPassword_(password,salt),password_salt:salt,role,status:'ACTIVE',
    created_at:now_(),last_login:'',otp_email:email,totp_secret:'',totp_enabled:'FALSE',failed_attempts:0,locked_until:''
  });
  audit_(actor.admin_id,actor.role,'ADMIN_CREATE','ADMIN',id,'SUCCESS',role);
  return {ok:true,admin_id:id};
}
function adminSetAdminStatus_(p) {
  const actor=requireAdmin_(p.token,['SUPER_ADMIN']);
  const target=getRows_(TABS.ADMINS).find(x=>x.admin_id===String(p.admin_id||''));
  if(!target) throw new Error('Admin not found.');
  const status=String(p.status||'');
  if(!['ACTIVE','DISABLED'].includes(status)) throw new Error('Invalid status.');
  if(target.admin_id===actor.admin_id && status!=='ACTIVE') throw new Error('You cannot disable your own account.');
  updateRow_(TABS.ADMINS,target.__row,{status});
  audit_(actor.admin_id,actor.role,'ADMIN_STATUS','ADMIN',target.admin_id,'SUCCESS',status);
  return {ok:true};
}


/* =========================================================
   REGISTRATION AGREEMENT ADMIN
   ========================================================= */
function adminAgreementGet_(p) {
  requireAdmin_(p.token,['SUPER_ADMIN']);
  return {ok:true,agreement:currentAgreement_()};
}
function adminAgreementSave_(p) {
  const admin=requireAdmin_(p.token,['SUPER_ADMIN']);
  const title=String(p.title||'').trim(), version=String(p.version||'').trim(), text=String(p.text||'').trim();
  const ready=p.ready===true;
  if(!title || !version || !text) throw new Error('Agreement title, version and text are required.');
  if(text.length<100) throw new Error('Agreement text is too short to publish.');
  putSetting_('registration_agreement_title',title);
  putSetting_('registration_agreement_version',version);
  putSetting_('registration_agreement_text',text);
  putSetting_('registration_agreement_ready',ready?'TRUE':'FALSE');
  const a=currentAgreement_();
  audit_(admin.admin_id,admin.role,'AGREEMENT_PUBLISH','SETTINGS','registration_agreement','SUCCESS',
    JSON.stringify({title:a.title,version:a.version,hash:a.hash,ready:a.ready}));
  return {ok:true,hash:a.hash,ready:a.ready};
}


function adminAssignCustomerTeam_(p) {
  const admin=requireAdmin_(p.token,['SUPER_ADMIN','OPERATIONS_ADMIN']);
  const customerId=String(p.customer_id||'').trim();
  if(!getRows_(TABS.CUSTOMERS).some(x=>x.customer_id===customerId))throw new Error('Customer not found.');
  const name=String(p.member_name||'').trim(),role=String(p.role||'').trim();
  if(!name||!role)throw new Error('Team member name and role are required.');
  appendRow_(TABS.CUSTOMER_TEAM,{assignment_id:makeId_('TEAM'),customer_id:customerId,member_name:name,role,email:normalizeEmail_(p.email),phone:String(p.phone||''),status:'ACTIVE',assigned_at:now_(),assigned_by:admin.admin_id});
  audit_(admin.admin_id,admin.role,'CUSTOMER_TEAM_ASSIGN','CUSTOMER',customerId,'SUCCESS',role+': '+name);
  return {ok:true};
}

/* =========================================================
   INITIAL DATA
   ========================================================= */

function ensureRole_(role,description) {
  if(getRows_(TABS.ROLES).some(x=>String(x.role)===String(role))) return;
  appendRow_(TABS.ROLES,{role,description});
}

function seedRoles_() {
  [
    ['SUPER_ADMIN','Full system access'],
    ['OPERATIONS_ADMIN','Customers, KYC, ledger, trades and monitoring'],
    ['KYC_ADMIN','KYC review'],
    ['KYC_AGENT','Live KYC verification agent'],
    ['TRADE_ADMIN','Trade entry'],
    ['AUDITOR','Read-only audit and monitoring']
  ].forEach(r=>ensureRole_(r[0],r[1]));
}


/* =========================================================
   RESPONSE
   ========================================================= */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
