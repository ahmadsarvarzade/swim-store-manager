/*
 * Swim Store Manager - Firebase bridge
 * Requires firebase-app-compat.js, firebase-auth-compat.js and
 * firebase-database-compat.js to be loaded before this file.
 * This file intentionally does not read passwords or write to the database
 * until the authenticated owner explicitly calls a method.
 */
(function () {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDu2C2HtcDy-4rsoHcJ4hcEDR1RWACgpTw',
    authDomain: 'swim-store-manager.firebaseapp.com',
    databaseURL: 'https://swim-store-manager-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'swim-store-manager',
    storageBucket: 'swim-store-manager.firebasestorage.app',
    messagingSenderId: '741003941931',
    appId: '1:741003941931:web:e9108eb9196dc55394326e'
  };

  const OWNER_UID = 'ayIdpmx8wKelEQEmamkDnc20QPX2';
  const COLLECTIONS = [
    'products', 'customers', 'purchases', 'orders',
    'expenses', 'movements', 'cash'
  ];

  if (!window.firebase || !window.firebase.initializeApp) {
    window.SwimStoreFirebaseError = 'کتابخانه Firebase بارگذاری نشده است.';
    return;
  }

  let app;
  try {
    app = window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(FIREBASE_CONFIG);
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    window.SwimStoreFirebaseError = 'راه‌اندازی Firebase ناموفق بود.';
    return;
  }

  const auth = app.auth();
  const database = app.database(FIREBASE_CONFIG.databaseURL);
  const authReady = auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);

  function requireOwner() {
    const user = auth.currentUser;
    if (!user) throw new Error('ابتدا با حساب مالک وارد شو.');
    if (user.uid !== OWNER_UID) {
      auth.signOut().catch(() => {});
      throw new Error('این حساب اجازه دسترسی به فروشگاه را ندارد.');
    }
    return user;
  }

  function isEmptyState(state) {
    if (!state || typeof state !== 'object') return true;
    return COLLECTIONS.every((key) => !Array.isArray(state[key]) || state[key].length === 0);
  }

  function safeStringify(value) {
    try { return JSON.stringify(value ?? null); }
    catch (_) { return ''; }
  }

  function timeOf(record) {
    const raw = record && (record.updatedAt || record.createdAt);
    const value = raw ? Date.parse(raw) : 0;
    return Number.isFinite(value) ? value : 0;
  }

  function mergeSettings(base, local, remote) {
    const b = base || {};
    const l = local || {};
    const r = remote || {};
    const result = {};
    const keys = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]);
    keys.forEach((key) => {
      const localChanged = safeStringify(l[key]) !== safeStringify(b[key]);
      const remoteChanged = safeStringify(r[key]) !== safeStringify(b[key]);
      if (localChanged && !remoteChanged) result[key] = l[key];
      else if (remoteChanged && !localChanged) result[key] = r[key];
      else if (localChanged && remoteChanged) result[key] = l.updatedAt && r.updatedAt && Date.parse(r.updatedAt) > Date.parse(l.updatedAt) ? r[key] : l[key];
      else if (Object.prototype.hasOwnProperty.call(r, key)) result[key] = r[key];
      else if (Object.prototype.hasOwnProperty.call(l, key)) result[key] = l[key];
    });
    return result;
  }

  function mergeStates(baseState, localState, remoteState) {
    const base = baseState || {};
    const local = localState || {};
    const remote = remoteState || {};
    const conflicts = [];
    const merged = {
      ...remote,
      ...local,
      schemaVersion: Math.max(Number(local.schemaVersion || 1), Number(remote.schemaVersion || 1)),
      settings: mergeSettings(base.settings, local.settings, remote.settings)
    };

    COLLECTIONS.forEach((key) => {
      const baseItems = Array.isArray(base[key]) ? base[key] : [];
      const localItems = Array.isArray(local[key]) ? local[key] : [];
      const remoteItems = Array.isArray(remote[key]) ? remote[key] : [];
      const baseById = new Map(baseItems.filter(x => x && x.id != null).map(x => [String(x.id), x]));
      const localById = new Map(localItems.filter(x => x && x.id != null).map(x => [String(x.id), x]));
      const remoteById = new Map(remoteItems.filter(x => x && x.id != null).map(x => [String(x.id), x]));
      const ids = new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()]);
      const result = [];

      ids.forEach((id) => {
        const b = baseById.get(id);
        const l = localById.get(id);
        const r = remoteById.get(id);

        // This application currently has no ordinary delete action for records.
        // Keep a record removed on one side only when it was also absent remotely.
        if (!l && r) { result.push(r); return; }
        if (l && !r) { result.push(l); return; }
        if (!l && !r) return;
        if (!b) {
          if (l && r && safeStringify(l) !== safeStringify(r)) {
            const winner = timeOf(l) >= timeOf(r) ? l : r;
            conflicts.push({ collection: key, id, local: l, remote: r, detectedAt: new Date().toISOString() });
            result.push(winner);
          } else result.push(l || r);
          return;
        }

        const localChanged = safeStringify(l) !== safeStringify(b);
        const remoteChanged = safeStringify(r) !== safeStringify(b);
        if (localChanged && !remoteChanged) result.push(l);
        else if (remoteChanged && !localChanged) result.push(r);
        else if (localChanged && remoteChanged && safeStringify(l) !== safeStringify(r)) {
          const winner = timeOf(l) >= timeOf(r) ? l : r;
          conflicts.push({ collection: key, id, local: l, remote: r, detectedAt: new Date().toISOString() });
          result.push(winner);
        } else result.push(l || r);
      });

      merged[key] = result;
    });

    return { state: merged, conflicts };
  }

  function storeRef() {
    requireOwner();
    return database.ref('stores/' + OWNER_UID + '/appState');
  }

  async function signIn(email, password) {
    await authReady;
    const credential = await auth.signInWithEmailAndPassword(String(email || '').trim(), String(password || ''));
    if (!credential.user || credential.user.uid !== OWNER_UID) {
      await auth.signOut();
      throw new Error('این ایمیل به حساب مالک فروشگاه تعلق ندارد.');
    }
    return { uid: credential.user.uid, email: credential.user.email || '' };
  }

  async function signOut() {
    await auth.signOut();
  }

  function observeAuth(callback) {
    return auth.onAuthStateChanged((user) => {
      if (user && user.uid !== OWNER_UID) {
        auth.signOut().catch(() => {});
        callback(null, new Error('حساب واردشده مالک فروشگاه نیست.'));
        return;
      }
      callback(user ? { uid: user.uid, email: user.email || '' } : null, null);
    });
  }

  function observeConnection(callback, onError) {
    return database.ref('.info/connected').on('value', (snapshot) => {
      callback(snapshot.val() === true);
    }, onError);
  }

  async function readRemoteState() {
    const snapshot = await storeRef().once('value');
    const envelope = snapshot.val();
    return envelope && envelope.state
      ? { state: envelope.state, revision: Number(envelope.revision || 0), updatedAt: envelope.updatedAt || null }
      : { state: null, revision: 0, updatedAt: null };
  }

  async function syncState(localState, baseState) {
    await authReady;
    const target = storeRef();
    let latestConflicts = [];
    const result = await target.transaction((current) => {
      const remoteState = current && current.state ? current.state : null;
      let mergedState;

      if (!remoteState) {
        mergedState = localState;
        latestConflicts = [];
      } else if (!baseState && isEmptyState(localState)) {
        mergedState = remoteState;
        latestConflicts = [];
      } else {
        const merged = mergeStates(baseState, localState, remoteState);
        mergedState = merged.state;
        latestConflicts = merged.conflicts;
      }

      return {
        schemaVersion: 1,
        revision: Number(current && current.revision || 0) + 1,
        updatedAt: new Date().toISOString(),
        lastWriterUid: OWNER_UID,
        state: mergedState,
        conflicts: latestConflicts.length ? latestConflicts.slice(-50) : (current && current.conflicts ? current.conflicts : [])
      };
    }, undefined, false);

    if (!result.committed) throw new Error('همگام‌سازی در سرور ثبت نشد.');
    const envelope = result.snapshot.val();
    return {
      state: envelope && envelope.state ? envelope.state : localState,
      revision: Number(envelope && envelope.revision || 0),
      updatedAt: envelope && envelope.updatedAt || null,
      conflicts: Array.isArray(envelope && envelope.conflicts) ? envelope.conflicts : []
    };
  }

  function observeStore(callback, onError) {
    return storeRef().on('value', (snapshot) => {
      const envelope = snapshot.val();
      callback(envelope && envelope.state ? {
        state: envelope.state,
        revision: Number(envelope.revision || 0),
        updatedAt: envelope.updatedAt || null,
        conflicts: Array.isArray(envelope.conflicts) ? envelope.conflicts : []
      } : null);
    }, onError);
  }

  window.SwimStoreFirebase = Object.freeze({
    ownerUid: OWNER_UID,
    authReady,
    signIn,
    signOut,
    observeAuth,
    observeConnection,
    readRemoteState,
    syncState,
    observeStore,
    mergeStates,
    isEmptyState
  });
})();
