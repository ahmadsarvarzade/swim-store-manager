/*
 * Swim Store Manager - Firebase compatibility bridge
 * Firebase compat SDK scripts must be loaded before this file.
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
  const MAX_STATE_BYTES = 10 * 1024 * 1024;

  if (!window.firebase || !window.firebase.initializeApp) {
    window.SwimStoreFirebaseError = 'Ú©ØªØ§Ø¨Ø®Ø§Ù†Ù‡ Firebase Ø¨Ø§Ø±Ú¯Ø°Ø§Ø±ÛŒ Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª. Ø§ØªØµØ§Ù„ Ø§ÛŒÙ†ØªØ±Ù†Øª Ø±Ø§ Ø¨Ø±Ø±Ø³ÛŒ Ùˆ ØµÙØ­Ù‡ Ø±Ø§ Ø¯ÙˆØ¨Ø§Ø±Ù‡ Ø¨Ø§Ø² Ú©Ù†.';
    return;
  }

  let app;
  try {
    app = window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(FIREBASE_CONFIG);
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    window.SwimStoreFirebaseError = 'Ø±Ø§Ù‡â€ŒØ§Ù†Ø¯Ø§Ø²ÛŒ Firebase Ù†Ø§Ù…ÙˆÙÙ‚ Ø¨ÙˆØ¯.';
    return;
  }

  const auth = app.auth();
  const database = app.database(FIREBASE_CONFIG.databaseURL);
  const authReady = auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);

  function requireOwner() {
    const user = auth.currentUser;
    if (!user) throw new Error('Ø§Ø¨ØªØ¯Ø§ Ø¨Ø§ Ø­Ø³Ø§Ø¨ Ù…Ø§Ù„Ú© ÙˆØ§Ø±Ø¯ Ø´Ùˆ.');
    if (user.uid !== OWNER_UID) {
      auth.signOut().catch(() => {});
      throw new Error('Ø§ÛŒÙ† Ø­Ø³Ø§Ø¨ Ø§Ø¬Ø§Ø²Ù‡ Ø¯Ø³ØªØ±Ø³ÛŒ Ø¨Ù‡ ÙØ±ÙˆØ´Ú¯Ø§Ù‡ Ø±Ø§ Ù†Ø¯Ø§Ø±Ø¯.');
    }
    return user;
  }

  function isEmptyState(value) {
    if (!value || typeof value !== 'object') return true;
    return COLLECTIONS.every((key) =>
      !Array.isArray(value[key]) || value[key].length === 0
    );
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      const result = {};
      Object.keys(value).sort().forEach((key) => {
        result[key] = stableValue(value[key]);
      });
      return result;
    }
    return value;
  }

  function stableStringify(value) {
    try { return JSON.stringify(stableValue(value ?? null)); }
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
      const localChanged = stableStringify(l[key]) !== stableStringify(b[key]);
      const remoteChanged = stableStringify(r[key]) !== stableStringify(b[key]);

      if (localChanged && !remoteChanged) result[key] = l[key];
      else if (remoteChanged && !localChanged) result[key] = r[key];
      else if (localChanged && remoteChanged) {
        result[key] = Object.prototype.hasOwnProperty.call(r, key) && !Object.prototype.hasOwnProperty.call(l, key)
          ? r[key]
          : l[key];
      } else if (Object.prototype.hasOwnProperty.call(r, key)) result[key] = r[key];
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

        // The current application has no regular delete action for these records.
        if (!l && r) { result.push(r); return; }
        if (l && !r) { result.push(l); return; }
        if (!l && !r) return;

        if (!b) {
          if (l && r && stableStringify(l) !== stableStringify(r)) {
            const winner = timeOf(l) >= timeOf(r) ? l : r;
            conflicts.push({ collection: key, id, detectedAt: new Date().toISOString() });
            result.push(winner);
          } else {
            result.push(l || r);
          }
          return;
        }

        const localChanged = stableStringify(l) !== stableStringify(b);
        const remoteChanged = stableStringify(r) !== stableStringify(b);

        if (localChanged && !remoteChanged) result.push(l);
        else if (remoteChanged && !localChanged) result.push(r);
        else if (localChanged && remoteChanged && stableStringify(l) !== stableStringify(r)) {
          const winner = timeOf(l) >= timeOf(r) ? l : r;
          conflicts.push({ collection: key, id, detectedAt: new Date().toISOString() });
          result.push(winner);
        } else {
          result.push(l || r);
        }
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
    const credential = await auth.signInWithEmailAndPassword(
      String(email || '').trim(),
      String(password || '')
    );
    if (!credential.user || credential.user.uid !== OWNER_UID) {
      await auth.signOut();
      throw new Error('Ø§ÛŒÙ† Ø§ÛŒÙ…ÛŒÙ„ Ø¨Ù‡ Ø­Ø³Ø§Ø¨ Ù…Ø§Ù„Ú© ÙØ±ÙˆØ´Ú¯Ø§Ù‡ ØªØ¹Ù„Ù‚ Ù†Ø¯Ø§Ø±Ø¯.');
    }
    return { uid: credential.user.uid, email: credential.user.email || '' };
  }

  async function signOutOwner() {
    await auth.signOut();
  }

  function observeAuth(callback) {
    return auth.onAuthStateChanged((user) => {
      if (user && user.uid !== OWNER_UID) {
        auth.signOut().catch(() => {});
        callback(null, new Error('Ø­Ø³Ø§Ø¨ ÙˆØ§Ø±Ø¯Ø´Ø¯Ù‡ Ù…Ø§Ù„Ú© ÙØ±ÙˆØ´Ú¯Ø§Ù‡ Ù†ÛŒØ³Øª.'));
        return;
      }
      callback(user ? { uid: user.uid, email: user.email || '' } : null, null);
    });
  }

  function observeConnection(callback, onError) {
    const target = database.ref('.info/connected');
    const listener = (snapshot) => callback(snapshot.val() === true);
    target.on('value', listener, onError);
    return () => target.off('value', listener);
  }

  async function readRemoteState() {
    const snapshot = await storeRef().once('value');
    const envelope = snapshot.val();
    return envelope && envelope.state
      ? {
          state: envelope.state,
          revision: Number(envelope.revision || 0),
          updatedAt: envelope.updatedAt || null,
          conflicts: Array.isArray(envelope.conflicts) ? envelope.conflicts : []
        }
      : { state: null, revision: 0, updatedAt: null, conflicts: [] };
  }

  async function syncState(localState, baseState) {
    await authReady;
    const target = storeRef();
    let latestConflicts = [];
    let tooLarge = false;

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

      const serialized = JSON.stringify(mergedState);
      if (new Blob([serialized]).size > MAX_STATE_BYTES) {
        tooLarge = true;
        return;
      }

      return {
        schemaVersion: 1,
        revision: Number(current && current.revision || 0) + 1,
        updatedAt: new Date().toISOString(),
        lastWriterUid: OWNER_UID,
        state: mergedState,
        conflicts: latestConflicts.length
          ? latestConflicts.slice(-50)
          : (current && Array.isArray(current.conflicts) ? current.conflicts : [])
      };
    }, undefined, false);

    if (tooLarge) {
      throw new Error('Ø­Ø¬Ù… Ú©Ù„ Ø§Ø·Ù„Ø§Ø¹Ø§Øª Ùˆ ØªØµØ§ÙˆÛŒØ± Ø¨Ø±Ø§ÛŒ Ù‡Ù…Ú¯Ø§Ù…â€ŒØ³Ø§Ø²ÛŒ Ø²ÛŒØ§Ø¯ Ø´Ø¯Ù‡ Ø§Ø³Øª. Ø­Ø¬Ù… ØªØµØ§ÙˆÛŒØ± Ø±Ø§ Ú©Ø§Ù‡Ø´ Ø¨Ø¯Ù‡.');
    }
    if (!result.committed) throw new Error('Ù‡Ù…Ú¯Ø§Ù…â€ŒØ³Ø§Ø²ÛŒ Ø¯Ø± Ø³Ø±ÙˆØ± Ø«Ø¨Øª Ù†Ø´Ø¯.');

    const envelope = result.snapshot.val();
    return {
      state: envelope && envelope.state ? envelope.state : localState,
      revision: Number(envelope && envelope.revision || 0),
      updatedAt: envelope && envelope.updatedAt || null,
      conflicts: Array.isArray(envelope && envelope.conflicts) ? envelope.conflicts : []
    };
  }

  function observeStore(callback, onError) {
    const target = storeRef();
    const listener = (snapshot) => {
      const envelope = snapshot.val();
      callback(envelope && envelope.state ? {
        state: envelope.state,
        revision: Number(envelope.revision || 0),
        updatedAt: envelope.updatedAt || null,
        conflicts: Array.isArray(envelope.conflicts) ? envelope.conflicts : []
      } : null);
    };
    target.on('value', listener, onError);
    return () => target.off('value', listener);
  }

  window.SwimStoreFirebase = Object.freeze({
    ownerUid: OWNER_UID,
    authReady,
    signIn,
    signOut: signOutOwner,
    observeAuth,
    observeConnection,
    readRemoteState,
    syncState,
    observeStore,
    mergeStates,
    isEmptyState,
    stableStringify
  });
})();
