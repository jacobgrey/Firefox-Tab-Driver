/**
 * Tab group management — slot-based assignment of number keys to Firefox groups.
 *
 * Slots 1–10 map to keyboard shortcuts Ctrl+Shift+1 through Ctrl+Shift+0.
 * Each slot stores a Firefox group ID. Users assign existing groups to slots
 * via the popup. Pressing an unassigned slot creates a new group.
 * Group naming is done through Firefox's native UI.
 */
const TabGroups = (() => {
  // Maps slot number (1–10) to Firefox group ID.
  // Persisted in storage as config:groupAssignments.
  let slots = {};

  /**
   * Load slot assignments from storage, prune any that point to deleted groups.
   */
  async function init() {
    const stored = await browser.storage.local.get(StorageKeys.CONFIG_GROUP_ASSIGNMENTS);
    slots = stored[StorageKeys.CONFIG_GROUP_ASSIGNMENTS] || {};

    // Verify all assigned groups still exist
    const existingGroups = await browser.tabGroups.query({});
    const existingIds = new Set(existingGroups.map(g => g.id));
    let changed = false;

    for (const [slot, groupId] of Object.entries(slots)) {
      if (!existingIds.has(groupId)) {
        delete slots[slot];
        changed = true;
      }
    }

    if (changed) await saveSlots();
  }

  async function saveSlots() {
    await browser.storage.local.set({ [StorageKeys.CONFIG_GROUP_ASSIGNMENTS]: slots });
  }

  /**
   * Move a tab into the group assigned to a slot (1–10).
   * If no group is assigned to that slot, create a new group and assign it.
   */
  async function moveTabToGroup(tabId, slotNumber) {
    if (slotNumber < 1 || slotNumber > NUM_SLOTS) return;

    // Pinned tabs are exempt from grouping
    const tab = await browser.tabs.get(tabId);
    if (tab.pinned) return;

    let groupId = slots[slotNumber];

    // Verify the assigned group still exists
    if (groupId) {
      try {
        const group = await browser.tabGroups.get(groupId);
        // Move tab to group's window if needed
        if (tab.windowId !== group.windowId) {
          await browser.tabs.move(tabId, { windowId: group.windowId, index: -1 });
        }
      } catch (e) {
        // Group was deleted — clear the slot and create a new one
        delete slots[slotNumber];
        groupId = null;
      }
    }

    if (groupId) {
      await browser.tabs.group({ tabIds: [tabId], groupId });
    } else {
      // Create a new group with this tab
      const newGroupId = await browser.tabs.group({ tabIds: [tabId] });
      slots[slotNumber] = newGroupId;
      await saveSlots();
    }
  }

  /**
   * Assign an existing Firefox group to a slot.
   */
  async function assignSlot(slotNumber, groupId) {
    if (slotNumber < 1 || slotNumber > NUM_SLOTS) return;

    // Unassign this group from any other slot first
    for (const [slot, id] of Object.entries(slots)) {
      if (id === groupId) {
        delete slots[slot];
      }
    }

    slots[slotNumber] = groupId;
    await saveSlots();
  }

  /**
   * Unassign a slot.
   */
  async function unassignSlot(slotNumber) {
    delete slots[slotNumber];
    await saveSlots();
  }

  /**
   * Get current slot assignments with group details.
   * Returns an array of 10 entries: { slot, groupId, title, color, tabCount } or { slot, groupId: null }.
   */
  async function getSlotAssignments() {
    const existingGroups = await browser.tabGroups.query({});
    const allTabs = await browser.tabs.query({});
    const result = [];

    for (let i = 1; i <= NUM_SLOTS; i++) {
      const groupId = slots[i] || null;
      if (groupId) {
        const group = existingGroups.find(g => g.id === groupId);
        if (group) {
          const tabCount = allTabs.filter(t => t.groupId === groupId).length;
          result.push({ slot: i, groupId, title: group.title, color: group.color, tabCount });
        } else {
          // Stale — group was deleted
          delete slots[i];
          result.push({ slot: i, groupId: null });
        }
      } else {
        result.push({ slot: i, groupId: null });
      }
    }

    return result;
  }

  /**
   * Get all Firefox groups (for the assignment picker in the popup).
   */
  async function getAllGroups() {
    const groups = await browser.tabGroups.query({});
    const allTabs = await browser.tabs.query({});

    // Find which slot each group is assigned to (if any)
    const groupToSlot = {};
    for (const [slot, id] of Object.entries(slots)) {
      groupToSlot[id] = parseInt(slot);
    }

    return groups.map(g => ({
      id: g.id,
      title: g.title || "(untitled)",
      color: g.color,
      tabCount: allTabs.filter(t => t.groupId === g.id).length,
      assignedSlot: groupToSlot[g.id] || null
    }));
  }

  /**
   * Get all groups with their tabs (for export and popup group overview).
   */
  async function getGroupsWithTabs() {
    const allGroups = await browser.tabGroups.query({});
    const allTabs = await browser.tabs.query({});

    const groupToSlot = {};
    for (const [slot, id] of Object.entries(slots)) {
      groupToSlot[id] = parseInt(slot);
    }

    const result = [];

    for (const group of allGroups) {
      const tabs = allTabs.filter(t => t.groupId === group.id);
      result.push({
        id: group.id,
        title: group.title || "(untitled)",
        color: group.color,
        collapsed: group.collapsed,
        managedIndex: groupToSlot[group.id] || null,
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

    // Ungrouped tabs (exclude pinned — they're exempt from group management)
    const ungroupedTabs = allTabs.filter(t => !t.pinned && (t.groupId === -1 || t.groupId === undefined));
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

    // Sort: assigned groups first (by slot), then unassigned, then ungrouped last
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
   * Refresh slot map by verifying stored IDs against existing groups.
   */
  async function refreshManagedGroupMap() {
    const stored = await browser.storage.local.get(StorageKeys.CONFIG_GROUP_ASSIGNMENTS);
    slots = stored[StorageKeys.CONFIG_GROUP_ASSIGNMENTS] || {};

    const existingGroups = await browser.tabGroups.query({});
    const existingIds = new Set(existingGroups.map(g => g.id));

    for (const [slot, groupId] of Object.entries(slots)) {
      if (!existingIds.has(groupId)) {
        delete slots[slot];
      }
    }

    await saveSlots();
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
    moveTabToGroup,
    assignSlot,
    unassignSlot,
    getSlotAssignments,
    getAllGroups,
    getGroupsWithTabs,
    refreshManagedGroupMap,
    ensureUnsortedGroup
  };
})();
