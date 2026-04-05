/**
 * Tab age tracking — records first-seen timestamps keyed by URL.
 */
const TabAge = (() => {

  /**
   * Record the first-seen date for a URL if not already tracked.
   */
  async function recordIfNew(url) {
    if (!url || url === "about:blank" || url === "about:newtab") return;
    const key = StorageKeys.ageKey(url);
    const result = await browser.storage.local.get(key);
    if (!result[key]) {
      await browser.storage.local.set({ [key]: Date.now() });
    }
  }

  /**
   * Get first-seen timestamp for a URL. Returns null if untracked.
   */
  async function getAge(url) {
    const key = StorageKeys.ageKey(url);
    const result = await browser.storage.local.get(key);
    return result[key] || null;
  }

  /**
   * Get ages for multiple URLs at once.
   * Returns a map of url → timestamp (or null).
   */
  async function getAges(urls) {
    const keys = urls.map(u => StorageKeys.ageKey(u));
    const result = await browser.storage.local.get(keys);
    const map = {};
    for (const url of urls) {
      map[url] = result[StorageKeys.ageKey(url)] || null;
    }
    return map;
  }

  /**
   * Get tab IDs in a group whose URLs are older than the given number of days.
   */
  async function getTabsOlderThan(groupId, days) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const filter = groupId !== null ? { groupId } : {};
    const tabs = await browser.tabs.query(filter);
    const urls = tabs.map(t => t.url).filter(Boolean);
    const ages = await getAges(urls);

    return tabs.filter(t => {
      const age = ages[t.url];
      return age && age < cutoff;
    }).map(t => t.id);
  }

  /**
   * Bulk close tabs by their IDs.
   */
  async function bulkClose(tabIds) {
    if (tabIds.length > 0) {
      await browser.tabs.remove(tabIds);
    }
  }

  /**
   * Get all stored ages. Returns map of url → timestamp.
   */
  async function getAll() {
    const all = await browser.storage.local.get(null);
    const map = {};
    for (const [key, value] of Object.entries(all)) {
      if (StorageKeys.isAgeKey(key)) {
        map[StorageKeys.urlFromAgeKey(key)] = value;
      }
    }
    return map;
  }

  /**
   * Listener for tabs.onCreated — record age for new tabs.
   */
  function onTabCreated(tab) {
    if (tab.url) {
      recordIfNew(tab.url);
    }
  }

  /**
   * Listener for tabs.onUpdated — record age when URL changes.
   */
  function onTabUpdated(tabId, changeInfo) {
    if (changeInfo.url) {
      recordIfNew(changeInfo.url);
    }
  }

  return {
    recordIfNew,
    getAge,
    getAges,
    getTabsOlderThan,
    bulkClose,
    getAll,
    onTabCreated,
    onTabUpdated
  };
})();
