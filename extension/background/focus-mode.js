/**
 * Focus mode — consolidates all tabs into one window, groups ungrouped tabs
 * into "Unsorted", collapses all groups, and discards non-active tabs.
 */
const FocusMode = (() => {

  /**
   * Check if focus mode is currently active.
   */
  async function isActive() {
    const result = await browser.storage.local.get(StorageKeys.CONFIG_FOCUS_MODE_ACTIVE);
    return result[StorageKeys.CONFIG_FOCUS_MODE_ACTIVE] === true;
  }

  /**
   * Enter focus mode:
   * 1. Move all tabs from all windows into the current window
   * 2. Group any ungrouped tabs into the "Unsorted" group
   * 3. Collapse all groups
   * 4. Discard all non-active tabs
   * 5. Open a blank new tab as the active tab
   */
  async function enter() {
    const currentWindow = await browser.windows.getCurrent();
    const targetWindowId = currentWindow.id;

    // Get all tabs across all windows
    const allTabs = await browser.tabs.query({});

    // Move non-pinned tabs from other windows into the target window.
    // Pinned tabs are left where they are — they're exempt from focus mode.
    const otherWindowTabs = allTabs.filter(t => t.windowId !== targetWindowId && !t.pinned);
    for (const tab of otherWindowTabs) {
      try {
        await browser.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
      } catch (e) {
        // Tab may have been closed; skip
      }
    }

    // Close other windows that have no remaining tabs (pinned tabs stayed behind,
    // so windows with pinned tabs will still have tabs and stay open)
    const windows = await browser.windows.getAll({ populate: true });
    for (const win of windows) {
      if (win.id !== targetWindowId && win.tabs.length === 0) {
        try {
          await browser.windows.remove(win.id);
        } catch (e) {
          // Window may already be closed
        }
      }
    }

    // Group ungrouped tabs into "Unsorted" — exclude pinned tabs (can't be grouped)
    const freshTabs = await browser.tabs.query({ windowId: targetWindowId });
    const ungroupedIds = freshTabs
      .filter(t => !t.pinned && (t.groupId === -1 || t.groupId === undefined))
      .map(t => t.id);

    if (ungroupedIds.length > 0) {
      await TabGroups.ensureUnsortedGroup(ungroupedIds);
    }

    // Collapse all groups
    const groups = await browser.tabGroups.query({ windowId: targetWindowId });
    for (const group of groups) {
      try {
        await browser.tabGroups.update(group.id, { collapsed: true });
      } catch (e) {
        // Group may have been removed
      }
    }

    // Create a clean new tab and make it active
    await browser.tabs.create({ active: true, windowId: targetWindowId });

    // Discard all non-active tabs
    const finalTabs = await browser.tabs.query({ windowId: targetWindowId });
    const toDiscard = finalTabs.filter(t => !t.active).map(t => t.id);
    if (toDiscard.length > 0) {
      await browser.tabs.discard(toDiscard);
    }

    await browser.storage.local.set({ [StorageKeys.CONFIG_FOCUS_MODE_ACTIVE]: true });
  }

  /**
   * Exit focus mode:
   * Expand all groups.
   */
  async function exit() {
    const groups = await browser.tabGroups.query({});
    for (const group of groups) {
      try {
        await browser.tabGroups.update(group.id, { collapsed: false });
      } catch (e) {
        // Group may have been removed
      }
    }

    await browser.storage.local.set({ [StorageKeys.CONFIG_FOCUS_MODE_ACTIVE]: false });
  }

  /**
   * Toggle focus mode.
   */
  async function toggle() {
    if (await isActive()) {
      await exit();
    } else {
      await enter();
    }
    return await isActive();
  }

  return { isActive, enter, exit, toggle };
})();
