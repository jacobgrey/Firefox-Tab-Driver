/**
 * Tab group management — creation, querying, and tab-to-group moves.
 * Uses Firefox's native Tab Groups API exclusively.
 */
const TabGroups = (() => {
  // Maps group index (1-10) to Firefox group ID. Rebuilt on init and as groups change.
  let managedGroupIds = new Map();

  /**
   * Initialize managed groups on startup.
   * Reads stored names, finds or creates matching groups.
   */
  async function init() {
    const stored = await browser.storage.local.get(StorageKeys.CONFIG_GROUP_NAMES);
    const names = stored[StorageKeys.CONFIG_GROUP_NAMES] || MANAGED_GROUP_NAMES;

    const existingGroups = await browser.tabGroups.query({});

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const existing = existingGroups.find(g => g.title === name);
      if (existing) {
        managedGroupIds.set(i + 1, existing.id);
      }
      // Don't create empty groups eagerly — create on first use
    }
  }

  /**
   * Ensure a managed group exists for the given index (1–10).
   * Creates a new group with a placeholder tab if needed.
   * Returns the Firefox group ID.
   */
  async function ensureGroup(groupIndex) {
    const existingId = managedGroupIds.get(groupIndex);
    if (existingId) {
      // Verify it still exists
      try {
        await browser.tabGroups.get(existingId);
        return existingId;
      } catch (e) {
        // Group was deleted, fall through to create
        managedGroupIds.delete(groupIndex);
      }
    }

    const stored = await browser.storage.local.get(StorageKeys.CONFIG_GROUP_NAMES);
    const names = stored[StorageKeys.CONFIG_GROUP_NAMES] || MANAGED_GROUP_NAMES;
    const name = names[groupIndex - 1] || `Group ${groupIndex}`;

    // Create group with a placeholder tab. The tab must remain so the group
    // isn't auto-deleted (empty groups are destroyed by Firefox).
    // Callers that just need to add a tab should use moveTabToGroup() instead.
    const tempTab = await browser.tabs.create({ active: false, url: "about:blank" });
    const groupId = await browser.tabs.group({ tabIds: [tempTab.id] });
    await browser.tabGroups.update(groupId, { title: name });

    managedGroupIds.set(groupIndex, groupId);
    return groupId;
  }

  /**
   * Move a tab into a managed group by index (1–10).
   */
  async function moveTabToGroup(tabId, groupIndex) {
    if (groupIndex < 1 || groupIndex > 10) return;

    // Can't group pinned tabs — unpin first
    const tab = await browser.tabs.get(tabId);
    if (tab.pinned) {
      await browser.tabs.update(tabId, { pinned: false });
    }

    let groupId = managedGroupIds.get(groupIndex);

    if (groupId) {
      // Verify group still exists
      try {
        const group = await browser.tabGroups.get(groupId);
        // If tab is in a different window, move it to the group's window first
        if (tab.windowId !== group.windowId) {
          await browser.tabs.move(tabId, { windowId: group.windowId, index: -1 });
        }
      } catch (e) {
        managedGroupIds.delete(groupIndex);
        groupId = null;
      }
    }

    if (groupId) {
      await browser.tabs.group({ tabIds: [tabId], groupId });
    } else {
      // Create group with this tab as the first member
      const stored = await browser.storage.local.get(StorageKeys.CONFIG_GROUP_NAMES);
      const names = stored[StorageKeys.CONFIG_GROUP_NAMES] || MANAGED_GROUP_NAMES;
      const name = names[groupIndex - 1] || `Group ${groupIndex}`;

      const newGroupId = await browser.tabs.group({ tabIds: [tabId] });
      await browser.tabGroups.update(newGroupId, { title: name });
      managedGroupIds.set(groupIndex, newGroupId);
    }
  }

  /**
   * Get all groups with their tabs for sidebar display.
   * Returns both managed and unmanaged groups.
   */
  async function getGroupsWithTabs() {
    const allGroups = await browser.tabGroups.query({});
    const allTabs = await browser.tabs.query({});

    const stored = await browser.storage.local.get(StorageKeys.CONFIG_GROUP_NAMES);
    const names = stored[StorageKeys.CONFIG_GROUP_NAMES] || MANAGED_GROUP_NAMES;

    const result = [];

    for (const group of allGroups) {
      const tabs = allTabs.filter(t => t.groupId === group.id);
      const managedIndex = [...managedGroupIds.entries()]
        .find(([, id]) => id === group.id)?.[0] || null;

      result.push({
        id: group.id,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        managedIndex,
        tabs: tabs.map(t => ({
          id: t.id,
          url: t.url,
          title: t.title,
          favIconUrl: t.favIconUrl,
          active: t.active,
          discarded: t.discarded
        }))
      });
    }

    // Ungrouped tabs
    const ungroupedTabs = allTabs.filter(t => t.groupId === -1 || t.groupId === undefined);
    if (ungroupedTabs.length > 0) {
      result.push({
        id: null,
        title: "Ungrouped",
        color: null,
        collapsed: false,
        managedIndex: null,
        tabs: ungroupedTabs.map(t => ({
          id: t.id,
          url: t.url,
          title: t.title,
          favIconUrl: t.favIconUrl,
          active: t.active,
          discarded: t.discarded
        }))
      });
    }

    // Sort: managed groups first (by index), then unmanaged, then ungrouped last
    result.sort((a, b) => {
      if (a.managedIndex && b.managedIndex) return a.managedIndex - b.managedIndex;
      if (a.managedIndex) return -1;
      if (b.managedIndex) return 1;
      if (a.id === null) return 1;
      if (b.id === null) return -1;
      return 0;
    });

    return result;
  }

  /**
   * Rename a managed group.
   */
  async function renameGroup(groupIndex, newName) {
    const stored = await browser.storage.local.get(StorageKeys.CONFIG_GROUP_NAMES);
    const names = stored[StorageKeys.CONFIG_GROUP_NAMES] || [...MANAGED_GROUP_NAMES];
    names[groupIndex - 1] = newName;
    await browser.storage.local.set({ [StorageKeys.CONFIG_GROUP_NAMES]: names });

    const groupId = managedGroupIds.get(groupIndex);
    if (groupId) {
      try {
        await browser.tabGroups.update(groupId, { title: newName });
      } catch (e) {
        // Group may have been deleted
      }
    }
  }

  /**
   * Refresh the managed group ID map by scanning existing groups.
   */
  async function refreshManagedGroupMap() {
    const stored = await browser.storage.local.get(StorageKeys.CONFIG_GROUP_NAMES);
    const names = stored[StorageKeys.CONFIG_GROUP_NAMES] || MANAGED_GROUP_NAMES;
    const existingGroups = await browser.tabGroups.query({});

    managedGroupIds.clear();
    for (let i = 0; i < names.length; i++) {
      const match = existingGroups.find(g => g.title === names[i]);
      if (match) {
        managedGroupIds.set(i + 1, match.id);
      }
    }
  }

  /**
   * Get the "Unsorted" group ID, creating it if necessary.
   */
  async function ensureUnsortedGroup(tabIds) {
    const existingGroups = await browser.tabGroups.query({});
    const unsorted = existingGroups.find(g => g.title === UNSORTED_GROUP_NAME);

    if (unsorted && tabIds.length > 0) {
      await browser.tabs.group({ tabIds, groupId: unsorted.id });
      return unsorted.id;
    } else if (tabIds.length > 0) {
      const groupId = await browser.tabs.group({ tabIds });
      await browser.tabGroups.update(groupId, { title: UNSORTED_GROUP_NAME });
      return groupId;
    }
    return unsorted ? unsorted.id : null;
  }

  return {
    init,
    ensureGroup,
    moveTabToGroup,
    getGroupsWithTabs,
    renameGroup,
    refreshManagedGroupMap,
    ensureUnsortedGroup
  };
})();
