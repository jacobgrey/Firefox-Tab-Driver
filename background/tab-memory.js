/**
 * Tab memory enforcement — keeps non-active loaded tabs within MAX_LOADED_TABS.
 * Discards least-recently-activated tabs first.
 */
const TabMemory = (() => {
  // Tracks tab activation order. Most recent at end.
  let activationOrder = [];

  /**
   * Record a tab activation (move it to the end of the LRU list).
   */
  function recordActivation(tabId) {
    activationOrder = activationOrder.filter(id => id !== tabId);
    activationOrder.push(tabId);
  }

  /**
   * Remove a tab from the activation list (e.g., on close).
   */
  function removeTab(tabId) {
    activationOrder = activationOrder.filter(id => id !== tabId);
  }

  // When true, enforcement is paused (e.g., during import)
  let suspended = false;
  let enforcing = false;
  let enforcePending = false;

  function suspend() { suspended = true; }
  function resume() { suspended = false; }

  async function enforce() {
    if (suspended) return;

    // Serialize: if already running, queue one re-run after it finishes
    if (enforcing) {
      enforcePending = true;
      return;
    }
    enforcing = true;

    try {
      const tabs = await browser.tabs.query({});

      // Non-active, non-discarded tabs are candidates for counting and discarding
      const loadedNonActive = tabs.filter(t => !t.active && !t.discarded);

      // Read limit from storage, falling back to the compile-time constant
      const stored = await browser.storage.local.get(StorageKeys.CONFIG_MAX_LOADED_TABS);
      const limit = stored[StorageKeys.CONFIG_MAX_LOADED_TABS] || MAX_LOADED_TABS;

      const overLimit = loadedNonActive.length - limit;
      if (overLimit <= 0) return;

      // Score by LRU position: lower index = accessed longer ago = discard first
      const scored = loadedNonActive.map(tab => {
        const lruIndex = activationOrder.indexOf(tab.id);
        return { tabId: tab.id, score: lruIndex === -1 ? -1 : lruIndex };
      });

      // Sort ascending — lowest score = first to discard
      scored.sort((a, b) => a.score - b.score);

      const toDiscard = scored.slice(0, overLimit).map(s => s.tabId);

      if (toDiscard.length > 0) {
        await browser.tabs.discard(toDiscard);
      }
    } finally {
      enforcing = false;
      if (enforcePending) {
        enforcePending = false;
        enforce();
      }
    }
  }

  function onTabActivated(activeInfo) {
    recordActivation(activeInfo.tabId);
    enforce();
  }

  function onTabCreated(tab) {
    enforce();
  }

  function onTabRemoved(tabId) {
    removeTab(tabId);
  }

  function onTabUpdated(tabId, changeInfo) {
    if (changeInfo.discarded === false) {
      enforce();
    }
  }

  async function init() {
    const tabs = await browser.tabs.query({});
    const inactive = tabs.filter(t => !t.active).sort((a, b) => a.index - b.index);
    const active = tabs.filter(t => t.active);
    activationOrder = [...inactive, ...active].map(t => t.id);
    await enforce();
  }

  return {
    init, enforce, suspend, resume,
    onTabActivated, onTabCreated, onTabRemoved, onTabUpdated
  };
})();
