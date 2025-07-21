// firebase.js - Firebase initialization for BLAPL Loyalty App (Stage 1)
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut } from 'firebase/auth';
import { getFirestore, serverTimestamp, getDocs, doc, setDoc, getDoc, updateDoc, collection, addDoc, runTransaction, onSnapshot, query, orderBy, limit } from 'firebase/firestore';

// ---------- Firebase ----------
const firebaseConfig = {
  apiKey: "AIzaSyC4A4fr0B-cJTFhzYE6hQBq-Qw2t07XKlw",
  authDomain: "bla-dealer-app.firebaseapp.com",
  projectId: "bla-dealer-app",
  storageBucket: "bla-dealer-app.firebasestorage.app",
  messagingSenderId: "999902556520",
  appId: "1:999902556520:web:f7c215c1036cb2af5566dd",
  measurementId: "G-GQG741YCLF"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const ts = () => serverTimestamp();

export { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut, doc, setDoc, getDoc, updateDoc, collection, addDoc, runTransaction, onSnapshot, query, orderBy, limit, getDocs, serverTimestamp };

/* ================= Firebase Stage 1 Integration ================= */

const USE_FIREBASE = true;
const ADMIN_EMAILS = new Set([
  'shawn@tjspecialty.com',
  'jodi@tjspecialty.com',
  'kevin@tjspecialty.com'
]);

// Interval and coupon constants
const CHECKIN_INTERVAL_HOURS = 156; // 6 days 12 hours
const CHECKIN_INTERVAL_MS = CHECKIN_INTERVAL_HOURS * 3600 * 1000;
const COUPON_MODULO = 5;

async function fbEnsure() {
  if (window._fb) return window._fb;
  window._fb = await import('./firebase.js');
  return window._fb;
}

// Hydrate Auth + Users + Check-Ins + Coupons
(async function initFirebase() {
  if (!USE_FIREBASE) return;
  const {
    auth, db, ts,
    onAuthStateChanged, collection, onSnapshot,
    addDoc, runTransaction, doc, query, orderBy, getDocs, serverTimestamp
  } = await fbEnsure();

  // 1. Auth listener
  onAuthStateChanged(auth, user => {
    window.__setAuthUserId?.(user?.uid || null);
    attachCouponListener(user?.uid);
  });

  // 2. Users listener
  let unsubUsers = null;
  function attachUsersListener() {
    if (unsubUsers) unsubUsers();
    unsubUsers = onSnapshot(collection(db, 'users'), snap => {
      const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      window.__setUsers?.(users);
    });
  }
  attachUsersListener();

  // 3. Coupon listener
  let unsubCoupons = null;
  function attachCouponListener(uid) {
    if (unsubCoupons) { unsubCoupons(); unsubCoupons = null; }
    if (!uid) return;
    const col = collection(db, 'users', uid, 'coupons');
    const q   = query(col, orderBy('createdAt', 'asc'));
    unsubCoupons = onSnapshot(q, snap => {
      const history  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const available = history.filter(c => !c.redeemedAt).length;
      window.__updateUserCoupons?.(uid, { history, available });
    });
  }

  // 4. Check-in function
  window.fbPerformCheckIn = async (uid) => {
    return runTransaction(db, async tx => {
      const uRef = doc(db, 'users', uid);
      const uSnap = await tx.get(uRef);
      if (!uSnap.exists()) throw new Error('USER_MISSING');
      const u = uSnap.data() || {};
      const last = u.lastCheckInAt?.toMillis?.() || 0;
      if (last && Date.now() - last < CHECKIN_INTERVAL_MS) throw new Error('TOO_SOON');

      const newTotal = (u.totalCheckIns || 0) + 1;
      tx.update(uRef, {
        lastCheckInAt: serverTimestamp(),
        totalCheckIns: newTotal,
        couponsAvailable: (u.couponsAvailable || 0) + (newTotal % COUPON_MODULO === 0 ? 1 : 0)
      });

      // Add check-in doc
      const ciRef = doc(collection(db, 'users', uid, 'checkIns'));
      tx.set(ciRef, { ts: serverTimestamp(), deleted: false });

      // Add coupon doc if threshold
      if (newTotal % COUPON_MODULO === 0) {
        const cpRef = doc(collection(db, 'users', uid, 'coupons'));
        tx.set(cpRef, { createdAt: serverTimestamp(), redeemedAt: null });
      }
    });
  };

  // 5. Coupon redemption
  window.fbRedeemCoupon = async (uid) => {
    const { auth } = await fbEnsure();
    // Fetch earliest unredeemed
    const allSnap = await getDocs(query(collection(db, 'users', uid, 'coupons'), orderBy('createdAt', 'asc')));
    const target = allSnap.docs.find(d => !d.data().redeemedAt);
    if (!target) throw new Error('NO_COUPON');
    return runTransaction(db, async tx => {
      const uRef = doc(db, 'users', uid);
      const cRef = doc(db, 'users', uid, 'coupons', target.id);
      const uSnap = await tx.get(uRef);
      if ((uSnap.data().couponsAvailable || 0) < 1) throw new Error('NO_COUPON');
      tx.update(cRef, { redeemedAt: serverTimestamp() });
      tx.update(uRef, { couponsAvailable: (uSnap.data().couponsAvailable || 0) - 1 });
    });
  };
})();
/* ================= End Firebase Stage 1 Integration ================= */
