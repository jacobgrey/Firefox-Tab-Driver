/**
 * Import/Export — full state serialization as JSON.
 */
const ImportExport = (() => {

  const EXPORT_VERSION = 2;

  /**
   * Export all tab data: groups, URLs, ages, and config.
   */
  async function exportAll() {
    const groupsWithTabs = await TabGroups.getGroupsWithTabs();
    const allAges = await TabAge.getAll();

    const stored = await browser.storage.local.get([
      StorageKeys.CONFIG_MAX_LOADED_TABS,
      StorageKeys.CONFIG_GROUP_NAMES
    ]);

    const groups = groupsWithTabs
      .filter(g => g.id !== null)
      .map(g => ({ name: g.title, color: g.color }));

    const tabs = [];
    for (const group of groupsWithTabs) {
      for (const tab of group.tabs) {
        tabs.push({
          url: tab.url,
          group: group.title,
          firstSeen: allAges[tab.url] || null
        });
      }
    }

    return {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      groups,
      tabs,
      config: {
        maxLoadedTabs: stored[StorageKeys.CONFIG_MAX_LOADED_TABS] || MAX_LOADED_TABS,
        groupNames: stored[StorageKeys.CONFIG_GROUP_NAMES] || MANAGED_GROUP_NAMES
      }
    };
  }

  /**
   * Import tab data from a JSON export.
   */
  async function importAll(data) {
    if (!data || data.version !== EXPORT_VERSION) {
      throw new Error("Invalid or unsupported export format (expected version " + EXPORT_VERSION + ").");
    }

    // Import config
    if (data.config) {
      const configUpdate = {};
      if (data.config.maxLoadedTabs) {
        configUpdate[StorageKeys.CONFIG_MAX_LOADED_TABS] = data.config.maxLoadedTabs;
      }
      if (data.config.groupNames) {
        configUpdate[StorageKeys.CONFIG_GROUP_NAMES] = data.config.groupNames;
      }
      if (Object.keys(configUpdate).length > 0) {
        await browser.storage.local.set(configUpdate);
      }
    }

    // Import ages
    const storageUpdate = {};
    for (const tab of data.tabs) {
      if (tab.firstSeen) {
        storageUpdate[StorageKeys.ageKey(tab.url)] = tab.firstSeen;
      }
    }
    if (Object.keys(storageUpdate).length > 0) {
      await browser.storage.local.set(storageUpdate);
    }

    // Build a map of group name → tab URLs
    const groupTabs = {};
    for (const tab of data.tabs) {
      const groupName = tab.group || "Ungrouped";
      if (!groupTabs[groupName]) groupTabs[groupName] = [];
      groupTabs[groupName].push(tab.url);
    }

    TabMemory.suspend();

    for (const [groupName, urls] of Object.entries(groupTabs)) {
      const createdTabIds = [];
      for (const url of urls) {
        try {
          const tab = await browser.tabs.create({ url, active: false });
          createdTabIds.push(tab.id);
        } catch (e) {
          // Invalid URL, skip
        }
      }

      if (createdTabIds.length > 0 && groupName !== "Ungrouped") {
        const existing = await browser.tabGroups.query({});
        const match = existing.find(g => g.title === groupName);
        if (match) {
          await browser.tabs.group({ tabIds: createdTabIds, groupId: match.id });
        } else {
          const groupId = await browser.tabs.group({ tabIds: createdTabIds });
          await browser.tabGroups.update(groupId, { title: groupName });
        }
      }
    }

    await TabGroups.refreshManagedGroupMap();
    TabMemory.resume();
    await TabMemory.enforce();
  }

  return { exportAll, importAll };
})();
