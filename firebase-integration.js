/*
 * Swim Store Manager - offline-first Firebase integration.
 * Loaded after app.js and firebase-sync.js as a classic script.
 *
 * It connects to the app's existing top-level lexical bindings:
 * state, db, persist, render, defaultState, updateSidebarMeta, etc.
 */
(() => {
  'use strict';

  const OWNER_UID = 'ayIdpmx8wKelEQEmamkDnc20QPX2';
  const SYNC_BASE_KEY = 'firebase-sync-base-v1';
  const bridge = () => window.SwimStoreFirebase;
  const $ = (selector, root = document) => root.querySelector(selector);

  let appReady = false;
  let currentUser = null;
  let connected = false;
  let applyingRemote = false;
  let syncing = false;
  let pendingSync = false;
  let pendingRemoteRevision = 0;
  let lastRevision = 0;
  let syncTimer = null;
  let stopAuth = null;
  let stopConnection = null;
  let stopStore = null;
  let persistWrapped = false;  // Track local writes so cloud sync cannot replace newer local data. let localMutationVersion = 0;

  const shell = $('.app-shell');
  if (shell) shell.style.display = 'none';

  const style = document.createElement('style');
  style.textContent = `
    .ss-auth-gate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;background:#f3f6fa;font-family:Tahoma,sans-serif}
    .ss-auth-card{width:min(430px,100%);background:#fff;border:1px solid #e4eaf0;border-radius:18px;padding:26px;box-shadow:0 18px 55px #0b172822;color:#17283d}
    .ss-auth-card h1{font-size:19px;margin:0 0 8px}.ss-auth-card p{font-size:12px;line-height:2;color:#718096;margin:0 0 20px}
    .ss-auth-field{display:grid;gap:7px;margin:13px 0}.ss-auth-field label{font-size:11px;color:#52657b}
    .ss-auth-field input{width:100%;box-sizing:border-box;border:1px solid #dce5ed;border-radius:9px;padding:12px;font:14px Tahoma,sans-serif}
    .ss-auth-submit{width:100%;border:0;border-radius:9px;padding:12px;background:#24b8a5;color:#063a38;font:700 13px Tahoma,sans-serif;cursor:pointer;margin-top:8px}
    .ss-auth-submit:disabled{opacity:.6;cursor:wait}.ss-auth-error{min-height:22px;color:#bf4754;font-size:11px;line-height:1.8;margin-top:12px}
    .ss-auth-note{font-size:10px;color:#8b99a8;margin-top:12px;line-height:1.9}
  `;
  document.head.appendChild(style);

  const gate = document.createElement('section');
  gate.className = 'ss-auth-gate';
  gate.innerHTML = `
    <div class="ss-auth-card" dir="rtl">
      <h1>ورود به Swim Store Manager</h1>
      <p>با حساب مالک وارد شو. همین حساب را می‌توانی روی مک و آیفون استفاده کنی.</p>
      <form id="ssOwnerLogin" autocomplete="on">
        <div class="ss-auth-field">
          <label for="ssOwnerEmail">ایمیل حساب مالک</label>
          <input id="ssOwnerEmail" name="email" type="email" autocomplete="username" required>
        </div>
        <div class="ss-auth-field">
          <label for="ssOwnerPassword">رمز عبور</label>
          <input id="ssOwnerPassword" name="password" type="password" autocomplete="current-password" required>
        </div>
        <button class="ss-auth-submit" type="submit">ورود به فروشگاه</button>
        <div id="ssAuthError" class="ss-auth-error" role="status" aria-live="polite"></div>
      </form>
      <div class="ss-auth-note">در هر دو دستگاه همه امکانات فعال است. چیدمان متناسب با اندازه صفحه تغییر می‌کند؛ فروش سریع در موبایل و ثبت کالا در دسکتاپ دسترس‌پذیرتر است. اطلاعات در حالت آفلاین محلی ذخیره و پس از اتصال همگام می‌شود.</div>
    </div>`;
  document.body.appendChild(gate);

  function setStatus(message, kind = 'normal') {
    const badge = $('.local-badge');
    if (!badge) return;
    badge.textContent = message;
    badge.style.color = kind === 'error' ? '#b44b55' : kind === 'pending' ? '#9a7134' : '#288d79';
    badge.title = message;
  }

  function showGate(message = '') {
    if (shell) shell.style.display = 'none';
    gate.style.display = 'grid';
    if (message) $('#ssAuthError').textContent = message;
  }

  function showApp() {
    gate.style.display = 'none';
    if (shell) shell.style.display = '';
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const result = {};
      Object.keys(value).sort().forEach((key) => result[key] = canonical(value[key]));
      return result;
    }
    return value;
  }

  function same(a, b) {
    return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
  }

  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error || new Error('خواندن پایگاه داده محلی ناموفق بود.'));
    });
  }

  async function readSyncBase() {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    return idbRequest(transaction.objectStore(STORE_NAME).get(SYNC_BASE_KEY));
  }

  async function saveSyncBase(value) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(clone(value), SYNC_BASE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('ذخیره نقطه مبنای همگام‌سازی ناموفق بود.'));
      transaction.onabort = () => reject(transaction.error || new Error('ذخیره نقطه مبنای همگام‌سازی لغو شد.'));
    });
  }

  function snapshotLocalState() {
    return clone(state);
  }

  async function applyRemoteState(remoteState) {
    applyingRemote = true;
    try {
      const defaults = defaultState();
      state = {
        ...defaults,
        ...clone(remoteState),
        settings: { ...defaults.settings, ...(remoteState.settings || {}) }
      };
      await persist();
      updateSidebarMeta();
      render();
    } finally {
      applyingRemote = false;
    }
  }

  function installPersistenceHook() {
    if (persistWrapped) return;
    const originalPersist = persist;
    persist = function (...args) {
      return originalPersist.apply(this, args).then((result) => {
        if (currentUser && !applyingRemote) scheduleSync(600);
        return result;
      });
    };
    persistWrapped = true;
  }

  function dashboardDeviceShortcuts() {
    if (typeof dashboardView !== 'function') return;
    const originalDashboardView = dashboardView;
    dashboardView = function () {
      let html = originalDashboardView();
      if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
        html = html.replace('＋ ثبت سفارش', '⚡ فروش سریع');
      } else {
        const backupButton = '<button class="btn btn-secondary" data-action="open-backup">⇩ پشتیبان</button>';
        html = html.replace(
          backupButton,
          '<button class="btn btn-secondary" data-action="open-backup">⇩ پشتیبان</button><button class="btn btn-secondary" data-action="new-product">＋ افزودن کالا</button>'
        );
      }
      return html;
    };
  }

  function improveSettingsCopy() {
    if (typeof settingsView !== 'function') return;
    const originalSettingsView = settingsView;
    settingsView = function () {
      let html = originalSettingsView();
      html = html.replace(
        'اطلاعات اصلی در پایگاه داده محلی مرورگر (IndexedDB) ذخیره می‌شود. پاک‌کردن داده‌های سایت یا مرورگر ممکن است اطلاعات را حذف کند؛ به‌صورت منظم فایل پشتیبان بگیر و آن را در محل امن دیگری نگه دار.',
        'اطلاعات ابتدا در پایگاه داده محلی همین دستگاه (IndexedDB) ذخیره می‌شود و پس از اتصال اینترنت با دستگاه دیگر همگام خواهد شد. پاک‌کردن داده‌های مرورگر ممکن است اطلاعات محلیِ همگام‌نشده را حذف کند؛ نسخه پشتیبان را نگه دار.'
      );
      html = html.replace('آمار فعلی پایگاه داده محلی این دستگاه.', 'آمار فعلی اطلاعات فروشگاه روی این دستگاه.');
      html = html.replace(
        '<li>همگام‌سازی خودکار بین دستگاه‌ها وجود ندارد.</li><li>برای نصب روی iPhone و Mac باید برنامه روی یک نشانی HTTPS میزبانی شود.</li><li>از ورود هم‌زمان چند کاربر یا چند دستگاه به یک پایگاه داده مشترک پشتیبانی نمی‌شود.</li>',
        '<li>همگام‌سازی بین آیفون و مک با حساب مالک انجام می‌شود.</li><li>در زمان قطعی اینترنت، اطلاعات روی همان دستگاه ذخیره و بعداً ارسال می‌شود.</li><li>هر دو دستگاه امکان ثبت و ویرایش کالا، فروش و فاکتور را دارند.</li>'
      );
      return html;
    };
  }

  async function performSync() {
    if (!currentUser || !appReady || !bridge() || !connected || !navigator.onLine) return false;
    if (syncing) {
      pendingSync = true;
      return false;
    }

    syncing = true;
    let syncSucceeded = false;
    try {
      const remote = await bridge().readRemoteState();
      const base = await readSyncBase();
      const local = snapshotLocalState();
      let result;

      if (!remote.state) {
        result = await bridge().syncState(local, base);
      } else if (!base && bridge().isEmptyState(local)) {
        result = remote;
      } else if (base && same(local, base) && !same(remote.state, base)) {
        result = remote;
      } else if (same(local, remote.state)) {
        result = remote;
      } else {
        result = await bridge().syncState(local, base);
      }

      if (!result || !result.state) throw new Error('پاسخ دیتابیس ابری معتبر نیست.');
      if (!same(snapshotLocalState(), result.state)) {
        await applyRemoteState(result.state);
      }
      await saveSyncBase(result.state);
      lastRevision = Math.max(lastRevision, Number(result.revision || 0));
      syncSucceeded = true;

      const conflictCount = Array.isArray(result.conflicts) ? result.conflicts.length : 0;
      setStatus(
        conflictCount
          ? `همگام شد · ${conflictCount} تغییر هم‌زمان`
          : 'همگام‌سازی ابری انجام شد',
        conflictCount ? 'pending' : 'normal'
      );
    } catch (error) {
      console.warn('Cloud sync remains pending:', error);
      const message = error && error.message ? error.message : 'اتصال ابری برقرار نشد.';
      setStatus(
        message.includes('حجم کل اطلاعات') ? 'حجم اطلاعات برای همگام‌سازی زیاد است' : 'ذخیره محلی فعال · ارسال پس از اتصال',
        'pending'
      );
    } finally {
      syncing = false;
      if (pendingSync || pendingRemoteRevision > lastRevision) {
        pendingSync = false;
        pendingRemoteRevision = 0;
        if (connected && navigator.onLine) window.setTimeout(performSync, 200);
      }
    }
    return syncSucceeded;
  }

  function scheduleSync(delay = 700) {
    if (!currentUser || !appReady) return;
    if (!navigator.onLine || !connected) {
      setStatus('ذخیره محلی فعال · در انتظار اینترنت', 'pending');
      return;
    }
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(performSync, delay);
  }

  async function reconcileInitial() {
    if (!currentUser || !connected || !navigator.onLine) return;
    await performSync();
  }

  function stopRealtimeListeners() {
    try { if (typeof stopConnection === 'function') stopConnection(); } catch (_) {}
    try { if (typeof stopStore === 'function') stopStore(); } catch (_) {}
    stopConnection = null;
    stopStore = null;
    connected = false;
  }

  let activatingUid = null;
  async function activateOwner(user) {
    if (!user || user.uid !== OWNER_UID) {
      showGate('این حساب اجازه دسترسی به فروشگاه را ندارد.');
      return;
    }
    if (activatingUid === user.uid) return;
    activatingUid = user.uid;
    currentUser = user;
    setStatus('در حال اتصال به فضای ابری…', 'pending');

    stopRealtimeListeners();

    let initialSyncInProgress = true;
    let resolveInitialConnection;
    const initialConnection = new Promise((resolve) => {
      resolveInitialConnection = resolve;
    });

    stopConnection = bridge().observeConnection((isConnected) => {
      connected = Boolean(isConnected);
      // Firebase first emits false while establishing the transport.
      // Wait for a positive connection; the outer timeout handles offline mode.
      if (connected && resolveInitialConnection) {
        resolveInitialConnection(true);
        resolveInitialConnection = null;
      }
      if (connected && !initialSyncInProgress) {
        scheduleSync(150);
      } else if (!connected) {
        setStatus('ذخیره محلی فعال · در انتظار اینترنت', 'pending');
      }
    }, (error) => {
      console.warn('Firebase connection observer:', error);
      if (resolveInitialConnection) {
        resolveInitialConnection(false);
        resolveInitialConnection = null;
      }
      setStatus('وضعیت اتصال ابری نامشخص است', 'pending');
    });

    stopStore = bridge().observeStore((payload) => {
      if (!payload) return;
      const revision = Number(payload.revision || 0);
      if (revision <= lastRevision) return;
      pendingRemoteRevision = Math.max(pendingRemoteRevision, revision);
      if (connected && navigator.onLine && !initialSyncInProgress) scheduleSync(150);
    }, (error) => {
      console.warn('Firebase store listener:', error);
      setStatus('دریافت تغییرات ابری ناموفق بود', 'error');
    });

    try {
      // A fresh browser profile should download the shared store before it can
      // start entering its own records. Existing devices can still work offline.
      const firstConnection = await Promise.race([
        initialConnection,
        new Promise((resolve) => window.setTimeout(() => resolve(false), 8000))
      ]);

      const base = await readSyncBase();
      const local = snapshotLocalState();
      const hasLocalHistory = Boolean(base) || !bridge().isEmptyState(local);

      if (firstConnection && connected && navigator.onLine) {
        const synced = await performSync();
        if (!synced && !hasLocalHistory) {
          showGate('اتصال Firebase برقرار شد، اما دریافت اطلاعات فروشگاه موفق نبود. اتصال اینترنت و قوانین دیتابیس را بررسی کن و صفحه را دوباره بارگذاری کن.');
          return;
        }
      } else if (!hasLocalHistory) {
        showGate('این دستگاه هنوز اطلاعات فروشگاه را دریافت نکرده است. برای اولین ورود به اینترنت وصل شو و صفحه را دوباره بارگذاری کن.');
        return;
      }

      showApp();
    } catch (error) {
      console.warn('Initial sync pending:', error);
      const base = await readSyncBase().catch(() => null);
      const local = snapshotLocalState();
      if (!base && bridge().isEmptyState(local)) {
        showGate('دریافت اطلاعات فروشگاه انجام نشد. اینترنت را بررسی کن و صفحه را دوباره بارگذاری کن.');
        return;
      }
      showApp();
      setStatus('اطلاعات محلی فعال · همگام‌سازی در انتظار اتصال', 'pending');
    } finally {
      initialSyncInProgress = false;
      activatingUid = null;
      if (connected && navigator.onLine && pendingRemoteRevision > lastRevision) {
        pendingRemoteRevision = 0;
        scheduleSync(150);
      }
    }
  }

  function startAuthObserver() {
    if (stopAuth) return;
    if (window.SwimStoreFirebaseError || !bridge()) {
      showGate(window.SwimStoreFirebaseError || 'اتصال Firebase در دسترس نیست. اینترنت و بارگذاری کتابخانه‌ها را بررسی کن.');
      return;
    }
    stopAuth = bridge().observeAuth((user, error) => {
      if (error) {
        console.error(error);
        currentUser = null;
        showGate(error.message || 'احراز هویت ناموفق بود.');
        return;
      }
      if (!user) {
        currentUser = null;
        stopRealtimeListeners();
        showGate();
        return;
      }
      activateOwner(user);
    });
  }

  gate.querySelector('#ssOwnerLogin').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const data = new FormData(form);
    button.disabled = true;
    button.textContent = 'در حال ورود…';
    $('#ssAuthError').textContent = '';
    try {
      await bridge().signIn(data.get('email'), data.get('password'));
      $('#ssOwnerPassword').value = '';
    } catch (error) {
      console.error(error);
      $('#ssAuthError').textContent = error.code === 'auth/invalid-credential'
        ? 'ایمیل یا رمز عبور صحیح نیست.'
        : (error.message || 'ورود انجام نشد. اتصال اینترنت و اطلاعات ورود را بررسی کن.');
    } finally {
      button.disabled = false;
      button.textContent = 'ورود به فروشگاه';
    }
  });

  const signOutButton = document.createElement('button');
  signOutButton.type = 'button';
  signOutButton.className = 'btn btn-secondary';
  signOutButton.textContent = 'خروج';
  signOutButton.style.marginInlineStart = '8px';
  signOutButton.addEventListener('click', async () => {
    if (!confirm('از حساب فروشگاه خارج شوی؟ اطلاعات ذخیره‌شده روی این دستگاه پاک نمی‌شوند.')) return;
    try {
      await bridge().signOut();
    } catch (error) {
      console.error(error);
      setStatus('خروج از حساب انجام نشد', 'error');
    }
  });

  const localBadge = $('.local-badge');
  if (localBadge && localBadge.parentElement) {
    localBadge.parentElement.insertBefore(signOutButton, localBadge.nextSibling);
  }

  window.addEventListener('online', () => scheduleSync(150));
  window.addEventListener('offline', () => setStatus('ذخیره محلی فعال · در انتظار اینترنت', 'pending'));

  function startWhenLocalAppReady() {
    if (appReady) return;
    try {
      if (typeof db === 'undefined' || !db || typeof state === 'undefined') return;
      const content = $('#content');
      if (!content || !content.innerHTML.trim()) return;

      appReady = true;
      installPersistenceHook();
      dashboardDeviceShortcuts();
      improveSettingsCopy();
      startAuthObserver();
    } catch (error) {
      console.warn('Waiting for local application:', error);
    }
  }

  if (typeof render === 'function') {
    const originalRender = render;
    render = function (...args) {
      const result = originalRender.apply(this, args);
      startWhenLocalAppReady();
      return result;
    };
  }

  // The local app can finish its IndexedDB startup before this script executes.
  startWhenLocalAppReady();
  const readyPoll = window.setInterval(() => {
    startWhenLocalAppReady();
    if (appReady) window.clearInterval(readyPoll);
  }, 150);
  window.setTimeout(() => window.clearInterval(readyPoll), 30000);

  // A small internal interface is useful for diagnostics and future sync screens.
  window.SwimStoreSync = Object.freeze({
    syncNow: () => scheduleSync(0),
    getStatus: () => ({
      authenticated: Boolean(currentUser),
      connected,
      revision: lastRevision,
      syncing
    })
  });
})();
