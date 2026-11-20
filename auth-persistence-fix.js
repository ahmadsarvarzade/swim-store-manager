/*
 * Swim Store Manager - Firebase auth persistence ordering fix.
 * Wait for LOCAL persistence to finish before attaching the auth observer.
 */
(() => {
  'use strict';

  const originalBridge = window.SwimStoreFirebase;
  if (!originalBridge || !originalBridge.authReady || typeof originalBridge.observeAuth !== 'function') {
    window.SwimStoreAuthPatchError = 'Firebase bridge is unavailable; auth persistence patch could not start.';
  } else {
    const patchedBridge = Object.create(originalBridge);

    patchedBridge.observeAuth = function (callback) {
      let cancelled = false;
      let unsubscribe = null;

      Promise.resolve(originalBridge.authReady)
        .then(() => {
          if (cancelled) return;
          unsubscribe = originalBridge.observeAuth((user, error) => {
            if (!cancelled) callback(user, error);
          });
        })
        .catch((error) => {
          if (!cancelled) callback(null, error);
        });

      return () => {
        cancelled = true;
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    };

    window.SwimStoreFirebase = Object.freeze(patchedBridge);
  }

  const refreshButton = document.getElementById('refreshApp');
  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      // Local changes are written to IndexedDB before the app shows its save confirmation.
      // On restart the existing integration reconciles local data with Firebase.
      refreshButton.disabled = true;
      refreshButton.textContent = '…';
      window.location.reload();
    });
  }
})();
