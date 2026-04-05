/**
 * Browser state snapshot — captures and restores full window/tab/group state
 * as a testing safety net. Independent of the extension's normal import/export.
 */
const Snapshot = (() => {

  const STORAGE_KEY = "snapshot:browserState";

  /**
   * Capture the full browser state: windows, tabs, groups.
   */
  async function save() {
    const windows = await browser.windows.getAll({ populate: true });
    const allGroups = await browser.tabGroups.query({});

    const snapshot = {
      savedAt: new Date().toISOString(),
      windows: []
    };

    for (const win of windows) {
      const winGroups = allGroups.filter(g => g.windowId === win.id);

      snapshot.windows.push({
        focused: win.focused,
        state: win.state,       // "normal", "minimized", "maximized", "fullscreen"
        top: win.top,
        left: win.left,
        width: win.width,
        height: win.height,
        tabs: win.tabs.map(t => ({
          url: t.url,
          title: t.title,
          pinned: t.pinned,
          active: t.active,
          index: t.index,
          groupId: t.groupId,
          discarded: t.discarded
        })),
        groups: winGroups.map(g => ({
          id: g.id,
          title: g.title,
          color: g.color,
          collapsed: g.collapsed
        }))
      });
    }

    await browser.storage.local.set({ [STORAGE_KEY]: snapshot });
    return snapshot;
  }

  /**
   * Check whether a snapshot exists.
   */
  async function exists() {
    const result = await browser.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || null;
  }

  /**
   * Restore browser state from the saved snapshot.
   *
   * Strategy:
   * 1. Suspend memory enforcement so it doesn't interfere.
   * 2. Create all windows with their geometry.
   * 3. Create all tabs in the correct order within each window.
   * 4. Recreate groups and assign tabs.
   * 5. Pin tabs, set active tabs, apply discarded state.
   * 6. Close all pre-existing windows/tabs that weren't part of the restore.
   * 7. Resume enforcement.
   */
  async function restore() {
    const result = await browser.storage.local.get(STORAGE_KEY);
    const snapshot = result[STORAGE_KEY];
    if (!snapshot) throw new Error("No snapshot found.");

    TabMemory.suspend();

    // Track windows that existed before restore so we can close them after
    const preExistingWindows = (await browser.windows.getAll()).map(w => w.id);

    for (const winData of snapshot.windows) {
      // Create the window with one blank tab (required by Firefox)
      const newWin = await browser.windows.create({
        state: winData.state === "fullscreen" ? "normal" : winData.state,
        top: winData.top,
        left: winData.left,
        width: winData.width,
        height: winData.height
      });

      // The new window comes with one blank tab — we'll remove it at the end
      const placeholderTabId = newWin.tabs[0].id;

      // Create all tabs in order
      const createdTabs = [];
      for (const tabData of winData.tabs) {
        const createOpts = {
          windowId: newWin.id,
          url: tabData.url,
          active: false,  // Set active later to avoid focus thrashing
          discarded: tabData.discarded && !tabData.active
        };

        // Discarded tabs need a title so they show correctly in the tab strip
        if (createOpts.discarded) {
          createOpts.title = tabData.title;
        }

        let tab;
        try {
          tab = await browser.tabs.create(createOpts);
        } catch (e) {
          // Some URLs (e.g. about:debugging) can't be opened by extensions.
          // Create a fallback tab pointing to the URL as a search or skip.
          try {
            tab = await browser.tabs.create({
              windowId: newWin.id,
              url: "about:blank",
              active: false
            });
          } catch (e2) {
            continue;
          }
        }
        createdTabs.push({ tab, data: tabData });
      }

      // Recreate groups and assign tabs
      for (const groupData of winData.groups) {
        // Find tabs that belonged to this group
        const memberTabs = createdTabs
          .filter(ct => ct.data.groupId === groupData.id)
          .map(ct => ct.tab.id);

        if (memberTabs.length === 0) continue;

        const newGroupId = await browser.tabs.group({
          tabIds: memberTabs,
          createProperties: { windowId: newWin.id }
        });

        await browser.tabGroups.update(newGroupId, {
          title: groupData.title,
          color: groupData.color,
          collapsed: groupData.collapsed
        });

      }

      // Pin tabs (must happen after grouping — pinning removes from group)
      for (const { tab, data } of createdTabs) {
        if (data.pinned) {
          await browser.tabs.update(tab.id, { pinned: true });
        }
      }

      // Set the active tab
      const activeEntry = createdTabs.find(ct => ct.data.active);
      if (activeEntry) {
        await browser.tabs.update(activeEntry.tab.id, { active: true });
      }

      // Remove the placeholder tab
      try {
        await browser.tabs.remove(placeholderTabId);
      } catch (e) {
        // May already be gone if window had only one tab
      }

      // Restore fullscreen after tabs are placed
      if (winData.state === "fullscreen") {
        await browser.windows.update(newWin.id, { state: "fullscreen" });
      }

      // Track which window should be focused
      if (winData.focused) {
        await browser.windows.update(newWin.id, { focused: true });
      }
    }

    // Close all pre-existing windows
    for (const oldWinId of preExistingWindows) {
      try {
        await browser.windows.remove(oldWinId);
      } catch (e) {
        // Already closed
      }
    }

    // Refresh extension state
    await TabGroups.refreshManagedGroupMap();
    TabMemory.resume();
  }

  /**
   * Delete the saved snapshot.
   */
  async function clear() {
    await browser.storage.local.remove(STORAGE_KEY);
  }

  return { save, restore, exists, clear };
})();
