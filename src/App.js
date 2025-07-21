// App.js - BLAPL Loyalty App Prototype
// Based on Master Spec (see separate canvas)
// Focus: structure + in‑memory store + routing + core flows (check-in, coupons, admin)

/*
 Key Implementation Notes
 ------------------------
 - Internal check-in interval: 156 hours (6d12h). User-facing copy: "7 days".
 - Stackable coupons every 5 valid check-ins.
 - QR scan expects constant string 'bla-poker-checkin'.
 - Lightweight auth (in-memory users) with localStorage persistence layer.
 - Seeded admins: shawn@tjspecialty.com, jodi@tjspecialty.com, kevin@tjspecialty.com all pwd '123456'.
 - Admin capabilities: view users, redeem coupon, delete check-in (any), soft delete / restore user, rename user.
 - Local persistence: users + auditLog + auth session stored in localStorage (keys: blapl.users, blapl.audit, blapl.auth).
 - Toast notification system for success / error / info messages.
 - Accessibility & basic error handling stubs included.
*/

import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';

// ---- Constants ----
const CHECKIN_INTERVAL_HOURS = 156; // internal
const CHECKIN_INTERVAL_MS = CHECKIN_INTERVAL_HOURS * 3600 * 1000;
const QR_CONSTANT = 'bla-poker-checkin';
const COUPON_MODULO = 5;
const STORAGE_USERS = 'blapl.users';
const STORAGE_AUDIT = 'blapl.audit';
const STORAGE_AUTH = 'blapl.authUserId';

// ---- Utility Helpers ----
const now = () => Date.now();
const hoursSince = (ts) => (now() - ts) / 3600000;
const safeParse = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };

function formatRemainingDetailed(lastTs) {
  if (!lastTs) return 'Ready';
  const remainingMs = CHECKIN_INTERVAL_MS - (now() - lastTs);
  if (remainingMs <= 0) return 'Ready';
  const hours = Math.ceil(remainingMs / 3600000);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} remaining`;
  const days = Math.ceil(hours / 24);
  if (days === 1) return 'Less than 1 day';
  return `${days} days remaining`;
}

let _idCounter = 0; const genId = (p='id') => `${p}_${(++_idCounter).toString(36)}`;

const seedAdmins = [
  { email: 'shawn@tjspecialty.com', displayName: 'Shawn', isAdmin: true },
  { email: 'jodi@tjspecialty.com', displayName: 'Jodi', isAdmin: true },
  { email: 'kevin@tjspecialty.com', displayName: 'Kevin', isAdmin: true }
];

function createSeedUsers() {
  return seedAdmins.map(a => ({
    id: genId('u'),
    email: a.email,
    passwordHash: '123456',
    displayName: a.displayName,
    isAdmin: a.isAdmin,
    isActive: true,
    lastCheckInAt: 0,
    totalCheckIns: 0,
    couponsAvailable: 0,
    couponHistory: [],
    checkIns: [],
  }));
}

// ---- Toast System ----
const ToastContext = React.createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]); // {id,type,msg}
  const push = (type, msg, ttl=4000) => {
    const id = genId('toast');
    setToasts(t => [...t, { id, type, msg }]);
    if (ttl) setTimeout(()=> setToasts(t => t.filter(x=>x.id!==id)), ttl);
  };
  return <ToastContext.Provider value={{ push }}>
    {children}
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}
    </div>
  </ToastContext.Provider>;
}
const useToasts = () => useContext(ToastContext);

// ---- App Data Context ----
const AppContext = React.createContext(null);

function loadInitialUsers() {
  const raw = localStorage.getItem(STORAGE_USERS);
  if (!raw) return createSeedUsers();
  const data = safeParse(raw, []);
  if (!Array.isArray(data) || !data.length) return createSeedUsers();
  return data;
}
function loadInitialAudit() {
  return safeParse(localStorage.getItem(STORAGE_AUDIT), []);
}
function loadInitialAuth() {
  return localStorage.getItem(STORAGE_AUTH);
}

function AppProvider({ children }) {
  const [users, setUsers] = useState(loadInitialUsers);
  const [authUserId, setAuthUserId] = useState(loadInitialAuth);
  const [auditLog, setAuditLog] = useState(loadInitialAudit);

  // Persist
  useEffect(()=> { localStorage.setItem(STORAGE_USERS, JSON.stringify(users)); }, [users]);
  useEffect(()=> { localStorage.setItem(STORAGE_AUDIT, JSON.stringify(auditLog.slice(0,500))); }, [auditLog]);
  useEffect(()=> { if (authUserId) localStorage.setItem(STORAGE_AUTH, authUserId); else localStorage.removeItem(STORAGE_AUTH); }, [authUserId]);

  const commitAudit = (type, meta, actorUserId) => {
    setAuditLog(l => [{ id: genId('log'), type, meta, ts: now(), actorUserId }, ...l.slice(0,499)]);
  };

  const findUser = (id) => users.find(u => u.id === id);
  const updateUser = (id, updater) => setUsers(prev => prev.map(u => u.id === id ? updater(u) : u));

  const addUser = (email, password, displayName) => {
    const exists = users.some(u => u.email.toLowerCase() === email.toLowerCase());
    if (exists) throw new Error('Email already exists.');
    const nu = { id: genId('u'), email, passwordHash: password, displayName, isAdmin: false, isActive: true, lastCheckInAt: 0, totalCheckIns: 0, couponsAvailable:0, couponHistory:[], checkIns:[] };
    setUsers(prev => [...prev, nu]);
    commitAudit('user.create', { userId: nu.id, email }, authUserId);
    return nu;
  };
  const softDeleteUser = (id) => { updateUser(id, u => ({ ...u, isActive:false })); commitAudit('user.softDelete', { userId:id }, authUserId); };
  const restoreUser = (id) => { updateUser(id, u => ({ ...u, isActive:true })); commitAudit('user.restore', { userId:id }, authUserId); };
  const renameUser = (id, newName) => { updateUser(id, u => ({ ...u, displayName:newName })); commitAudit('user.rename', { userId:id, newName }, authUserId); };

  const redeemCoupon = (userId) => {
    updateUser(userId, u => {
      if (u.couponsAvailable <= 0) return u;
      const couponIdx = u.couponHistory.findIndex(c => !c.redeemedAt);
      if (couponIdx === -1) return u;
      const updatedHistory = [...u.couponHistory];
      updatedHistory[couponIdx] = { ...updatedHistory[couponIdx], redeemedAt: now() };
      commitAudit('coupon.redeem', { userId, couponId: updatedHistory[couponIdx].id }, authUserId);
      return { ...u, couponsAvailable: u.couponsAvailable - 1, couponHistory: updatedHistory };
    });
  };

  // Hardened check-in logic
  const lastActionRef = useRef(0);
  const lastScanValRef = useRef('');
  const lastScanTsRef = useRef(0);

  const performCheckIn = useCallback((userId, scanValue='') => {
    const startTs = now();
    if (startTs - lastActionRef.current < 1200) throw new Error('BUSY');
    if (scanValue && scanValue === lastScanValRef.current && (startTs - lastScanTsRef.current) < 2500) {
      throw new Error('DUPLICATE');
    }
    lastActionRef.current = startTs;
    lastScanValRef.current = scanValue;
    lastScanTsRef.current = startTs;

    setUsers(prev => prev.map(u => {
      if (u.id !== userId) return u;
      if (u.lastCheckInAt) {
        const delta = startTs - u.lastCheckInAt;
        if (delta < 0) {
          commitAudit('clock.anomaly', { userId, last:u.lastCheckInAt, now:startTs }, authUserId);
          throw new Error('TIME_ANOMALY');
        }
        if (delta < CHECKIN_INTERVAL_MS) throw new Error('TOO_SOON');
      }
      const newCheckIn = { id: genId('ci'), ts: startTs };
      const newCheckIns = [...u.checkIns, newCheckIn];
      const totalCheckIns = u.totalCheckIns + 1;
      let couponsAvailable = u.couponsAvailable;
      let couponHistory = [...u.couponHistory];
      if (totalCheckIns % COUPON_MODULO === 0) {
        const coupon = { id: genId('cp'), createdAt: startTs, redeemedAt: null };
        couponHistory = [...couponHistory, coupon];
        couponsAvailable += 1;
        commitAudit('coupon.create', { userId, couponId: coupon.id }, authUserId);
      }
      commitAudit('checkin.add', { userId, checkInId: newCheckIn.id }, authUserId);
      return { ...u, checkIns: newCheckIns, totalCheckIns, couponsAvailable, couponHistory, lastCheckInAt: newCheckIn.ts };
    }));
  }, [authUserId]);

  const deleteCheckIn = (userId, checkInId) => {
    setUsers(prev => prev.map(u => {
      if (u.id !== userId) return u;
      const idx = u.checkIns.findIndex(c => c.id === checkInId);
      if (idx === -1) return u;
      const newCheckIns = u.checkIns.filter(c => c.id !== checkInId);
      const total = newCheckIns.length;
      const targetCouponCount = Math.floor(total / COUPON_MODULO);
      const existingSorted = [...u.couponHistory].sort((a,b)=>a.createdAt-b.createdAt);
      const rebuilt = [];
      let redeemedRemoved = [];
      for (let i=0;i<targetCouponCount;i++) {
        if (i < existingSorted.length) {
          rebuilt.push(existingSorted[i]);
        } else {
          rebuilt.push({ id: genId('cp'), createdAt: now(), redeemedAt:null });
        }
      }
      if (existingSorted.length > targetCouponCount) {
        const removed = existingSorted.slice(targetCouponCount);
        redeemedRemoved = removed.filter(c => c.redeemedAt);
      }
      if (redeemedRemoved.length) {
        commitAudit('coupon.invalidate', { userId, couponIds: redeemedRemoved.map(c=>c.id) }, authUserId);
      }
      const couponsAvailable = rebuilt.filter(c => !c.redeemedAt).length;
      commitAudit('checkin.delete', { userId, checkInId }, authUserId);
      return { ...u, checkIns: newCheckIns, totalCheckIns: total, couponsAvailable, couponHistory: rebuilt, lastCheckInAt: newCheckIns.length ? newCheckIns[newCheckIns.length-1].ts : 0 };
    }));
  };

  const login = (email, password) => {
    const u = users.find(x => x.email.toLowerCase() === email.toLowerCase());
    if (!u || u.passwordHash !== password) throw new Error('Invalid credentials');
    if (!u.isActive) throw new Error('Account inactive');
    setAuthUserId(u.id);
    return u;
  };
  const logout = () => setAuthUserId(null);

  return (
    <AppContext.Provider value={{ users, setUsers, authUserId, login, logout, performCheckIn, redeemCoupon, deleteCheckIn, softDeleteUser, restoreUser, renameUser, addUser, findUser, auditLog }}>
      {children}
    </AppContext.Provider>
  );
}

const useApp = () => useContext(AppContext);
const useAuthUser = () => {
  const { authUserId, findUser } = useApp();
  return authUserId ? findUser(authUserId) : null;
};

// ---- UI Components ----
function AuthGate({ children }) {
  const user = useAuthUser();
  const [view, setView] = useState('login');
  if (!user) {
    return <div className="auth-wrapper">{view === 'login' ? <LoginForm onSwitch={()=>setView('register')} /> : <RegisterForm onSwitch={()=>setView('login')} />}</div>;
  }
  return children;
}

function LoginForm({ onSwitch }) {
  const { login } = useApp();
  const { push } = useToasts();
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [error,setError] = useState('');
  const submit = (e)=>{e.preventDefault(); try { login(email,password); push('success','Logged in'); } catch(err){ setError(err.message);} };
  return <form onSubmit={submit} className="card">
    <h2>BLAPL Loyalty</h2>
    <div><input aria-label="Email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} /></div>
    <div><input aria-label="Password" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} /></div>
    {error && <div className="error" role="alert">{error}</div>}
    <button type="submit">Login</button>
    <div className="muted"><button type="button" onClick={onSwitch}>Need an account?</button></div>
  </form>;
}

function RegisterForm({ onSwitch }) {
  const { addUser } = useApp();
  const { push } = useToasts();
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [displayName,setDisplayName] = useState('');
  const [error,setError] = useState('');
  const submit=(e)=>{e.preventDefault(); try { const u=addUser(email,password,displayName||email.split('@')[0]); push('success',`Account created for ${u.displayName}`); onSwitch(); } catch(err){ setError(err.message);} };
  return <form onSubmit={submit} className="card">
    <h2>Create Account</h2>
    <input placeholder="Display Name" value={displayName} onChange={e=>setDisplayName(e.target.value)} />
    <input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
    <input placeholder="Password (min 6)" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
    {error && <div className="error" role="alert">{error}</div>}
    <button disabled={password.length<6}>Register</button>
    <div className="muted"><button type="button" onClick={onSwitch}>Have an account?</button></div>
  </form>;
}

function NavBar({ current, onChange }) {
  const user = useAuthUser();
  const { logout } = useApp();
  const { push } = useToasts();
  const tabs = [ 'scan', 'progress', 'leaderboard' ];
  if (user?.isAdmin) tabs.push('admin');
  return <nav className="nav" role="tablist">
    {tabs.map(t => <button key={t} role="tab" aria-selected={t===current} className={t===current? 'active':''} onClick={()=>onChange(t)}>{t}</button>)}
    <div className="grow" />
    <button onClick={()=>{logout(); push('info','Logged out');}}>Logout</button>
  </nav>;
}

function ScanView() {
  const user = useAuthUser();
  const { performCheckIn } = useApp();
  const { push } = useToasts();
  const [status,setStatus] = useState('Ready');
  const [error,setError] = useState('');
  const inputRef = useRef();

  const canCheckIn = !user.lastCheckInAt || (now() - user.lastCheckInAt) >= CHECKIN_INTERVAL_MS;
  const remaining = formatRemainingDetailed(user.lastCheckInAt);

  const simulateScan = (value) => {
    setError('');
    if (value !== QR_CONSTANT) { setError('Invalid code'); return; }
    try {
      performCheckIn(user.id, value);
      setStatus('Check-in successful');
      push('success','Check-in recorded');
    } catch(err) {
      if (err.message === 'TOO_SOON') setError(`Too soon – available in ${formatRemainingDetailed(user.lastCheckInAt)}`);
      else if (err.message === 'BUSY') setError('Processing previous scan…');
      else if (err.message === 'DUPLICATE') setError('Duplicate scan ignored');
      else if (err.message === 'TIME_ANOMALY') setError('Device time anomaly – adjust clock');
      else setError(err.message);
    }
  };

  const handleManual = () => {
    const val = (inputRef.current?.value || '').trim();
    if (!val) return;
    simulateScan(val);
  };

  return <div className="scan-view">
    <h2>Check-In</h2>
    <p>Status: {status}</p>
    <p>Interval: one per 7 days (internally 6d12h). Remaining: {remaining}</p>
    <div className="camera-placeholder">Camera / QR placeholder (manual code below)</div>
    <div className="manual-entry">
      <input ref={inputRef} placeholder="Enter code" aria-label="Manual code" />
      <button onClick={handleManual} disabled={!canCheckIn}>Submit</button>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
  </div>;
}

function ProgressView() {
  const user = useAuthUser();
  const progress = user.totalCheckIns % COUPON_MODULO;
  const toward = COUPON_MODULO - progress;
  return <div className="progress-view">
    <h2>Your Progress</h2>
    <p>Total check-ins: {user.totalCheckIns}</p>
    <p>Coupons available: {user.couponsAvailable}</p>
    <p>Progress toward next coupon: {progress}/5 (need {toward===0?5:toward} more)</p>
    <div className="badges">
      {Array.from({length:user.couponsAvailable}).map((_,i)=><span key={i} className="badge">🏅</span>)}
    </div>
  </div>;
}

function LeaderboardView() {
  const { users } = useApp();
  const current = useAuthUser();
  const activeUsers = users.filter(u=>u.isActive);
  const sorted = [...activeUsers].sort((a,b)=> b.totalCheckIns - a.totalCheckIns);
  const top = sorted.slice(0,10);
  const isInTop = top.some(u=>u.id===current.id);
  return <div className="leaderboard-view">
    <h2>Leaderboard</h2>
    <ol>
      {top.map(u=> <li key={u.id} className={u.id===current.id? 'me':''}>{u.displayName} – {u.totalCheckIns}</li>)}
    </ol>
    {!isInTop && <div className="you-rank">You: {sorted.findIndex(u=>u.id===current.id)+1} / {sorted.length} with {current.totalCheckIns}</div>}
  </div>;
}

function AdminView() {
  const { users, redeemCoupon, deleteCheckIn, softDeleteUser, restoreUser, renameUser } = useApp();
  const { push } = useToasts();
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [renameText,setRenameText] = useState('');
  const selected = users.find(u=>u.id===selectedUserId);
  return <div className="admin-view">
    <h2>Admin Dashboard</h2>
    <div className="admin-columns">
      <div className="user-list">
        <h3>Users</h3>
        <ul>
          {users.map(u=> <li key={u.id} className={u.id===selectedUserId? 'sel':''}>
            <button onClick={()=>{ setSelectedUserId(u.id); setRenameText(u.displayName); }}>{u.displayName}{!u.isActive && ' (inactive)'} – {u.totalCheckIns} ci / {u.couponsAvailable} cp</button>
          </li>)}
        </ul>
      </div>
      {selected && <div className="user-detail">
        <h3>{selected.displayName}</h3>
        <p>Email: {selected.email}</p>
        <p>Status: {selected.isActive? 'Active':'Inactive'}</p>
        <div className="rename-block">
          <input value={renameText} onChange={e=>setRenameText(e.target.value)} />
          <button onClick={()=>{ if(renameText.trim()){ renameUser(selected.id, renameText.trim()); push('success','Renamed'); } }} disabled={!renameText.trim()}>Rename</button>
        </div>
        <div className="user-actions">
          {selected.isActive ? <button onClick={()=>{softDeleteUser(selected.id); push('info','User deactivated');}}>Soft Delete</button> : <button onClick={()=>{restoreUser(selected.id); push('success','User restored');}}>Restore</button>}
        </div>
        <div className="coupons">
          <h4>Coupons</h4>
          <p>Available: {selected.couponsAvailable}</p>
          <button disabled={selected.couponsAvailable<=0} onClick={()=>{redeemCoupon(selected.id); push('success','Coupon redeemed');}}>Redeem One</button>
        </div>
        <div className="checkins">
          <h4>Check-Ins</h4>
          <ul>
            {selected.checkIns.map(ci=> <li key={ci.id}>{new Date(ci.ts).toLocaleString()} <button onClick={()=>{deleteCheckIn(selected.id, ci.id); push('warning','Check-in deleted & totals recomputed');}}>Delete</button></li>)}
          </ul>
        </div>
      </div>}
    </div>
  </div>;
}

function AppShell() {
  const [tab,setTab] = useState('scan');
  return <div className="app-shell">
    <NavBar current={tab} onChange={setTab} />
    <main>
      {tab==='scan' && <ScanView />}
      {tab==='progress' && <ProgressView />}
      {tab==='leaderboard' && <LeaderboardView />}
      {tab==='admin' && <AdminView />}
    </main>
  </div>;
}

export default function App() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(err => console.error('SW registration failed', err));
    }
  }, []);

  return <ToastProvider>
    <AppProvider>
      <AuthGate>
        <AppShell />
      </AuthGate>
    </AppProvider>
  </ToastProvider>;
}

// Inject global coupon update hook for Firebase listener (idempotent)
if (!window.__updateUserCoupons) {
  window.__updateUserCoupons = (uid, { history, available }) => {
    // Requires AppContext access; we patch via a microtask after React mounts
    queueMicrotask(() => {
      try {
        const r = document.__appSetUsersRef; // stored by AppProvider patch
        if (r) r(uid, history, available);
      } catch {}
    });
  };
}




