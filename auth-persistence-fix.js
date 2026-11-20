/*
 * Swim Store Manager - safer Firebase auth persistence.
 * SESSION keeps login through reloads in the same tab, but clears it when
 * the tab/window is closed. Explicit sign-out still clears it immediately.
 */
(() => {
  'use strict';

  const originalBridge = window.SwimStoreFirebase;
  const firebaseAuth = window.firebase && window.firebase.auth
    ? window.firebase.auth()
    : null;

  if (!originalBridge || !originalBridge.authReady || !firebaseAuth ||
      typeof originalBridge.observeAuth !== 'function') {
    window.SwimStoreAuthPatchError =
      'Firebase bridge is unavailable; session persistence could not be configured.';
  } else {
    const sessionReady = Promise.resolve(originalBridge.authReady)
      .then(() => firebaseAuth.setPersistence(
        window.firebase.auth.Auth.Persistence.SESSION
      ));

    const patchedBridge = {
      ...originalBridge,
      authReady: sessionReady,
      async signIn(email, password) {
        await sessionReady;
        return originalBridge.signIn(email, password);
      },
      observeAuth(callback) {
        let cancelled = false;
        let unsubscribe = null;

        sessionReady.then(() => {
          if (cancelled) return;
          unsubscribe = originalBridge.observeAuth((user, error) => {
            if (!cancelled) callback(user, error);
          });
        }).catch((error) => {
          if (!cancelled) callback(null, error);
        });

        return () => {
          cancelled = true;
          if (typeof unsubscribe === 'function') unsubscribe();
        };
      }
    };

    window.SwimStoreFirebase = Object.freeze(patchedBridge);
  }

  const refreshButton = document.getElementById('refreshApp');
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      refreshButton.disabled = true;
      refreshButton.textContent = '…';
      window.location.reload();
    });
  }
})();
