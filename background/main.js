/**
 * Background entry point — wires event listeners, handles commands and messages.
 */

// --- Initialization ---
(async () => {
  await TabGroups.init();
  await TabMemory.init();

  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.url) {
      TabAge.recordIfNew(tab.url);
    }
  }
})();

// --- Tab event listeners ---
browser.tabs.onActivated.addListener(TabMemory.onTabActivated);
browser.tabs.onCreated.addListener(TabMemory.onTabCreated);
browser.tabs.onCreated.addListener(TabAge.onTabCreated);
browser.tabs.onRemoved.addListener(TabMemory.onTabRemoved);
browser.tabs.onUpdated.addListener(TabMemory.onTabUpdated);
browser.tabs.onUpdated.addListener(TabAge.onTabUpdated);

// --- Keyboard commands ---
browser.commands.onCommand.addListener(async (command) => {
  if (command === "focus-toggle") {
    await FocusMode.toggle();
    return;
  }

  if (command === "open-triage") {
    // Open the triage page as a popup window
    await browser.windows.create({
      url: browser.runtime.getURL("triage/triage.html"),
      type: "popup",
      width: 420,
      height: 520
    });
    return;
  }

  // group-1 through group-10
  const match = command.match(/^group-(\d+)$/);
  if (match) {
    const groupIndex = parseInt(match[1]);
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      await TabGroups.moveTabToGroup(activeTab.id, groupIndex);
    }
  }
});

// --- Message handler (for popup and triage pages) ---
browser.runtime.onMessage.addListener((message) => {
  switch (message.action) {
    case "getUngroupedTabs":
      return getUngroupedTabs();

    case "getSlotAssignments":
      return TabGroups.getSlotAssignments();

    case "getAllGroups":
      return TabGroups.getAllGroups();

    case "assignSlot":
      return TabGroups.assignSlot(message.slotNumber, message.groupId)
        .then(() => ({ success: true }));

    case "unassignSlot":
      return TabGroups.unassignSlot(message.slotNumber)
        .then(() => ({ success: true }));

    case "moveTab":
      return TabGroups.moveTabToGroup(message.tabId, message.groupIndex);

    case "enterFocus":
      return FocusMode.enter().then(() => ({ focusModeActive: true }));

    case "exitFocus":
      return FocusMode.exit().then(() => ({ focusModeActive: false }));

    case "toggleFocus":
      return FocusMode.toggle().then(active => ({ focusModeActive: active }));

    case "isFocusModeActive":
      return FocusMode.isActive().then(active => ({ focusModeActive: active }));

    case "exportAll":
      return ImportExport.exportAll();

    case "importAll":
      return ImportExport.importAll(message.data);

    case "bulkCloseOlderThan":
      return TabAge.getTabsOlderThan(message.groupId, message.days)
        .then(tabIds => TabAge.bulkClose(tabIds))
        .then(() => ({ success: true }));

    case "sortByAge":
      return handleSortByAge(message.groupId, message.direction);

    case "snapshotSave":
      return Snapshot.save().then(s => ({ success: true, savedAt: s.savedAt }));

    case "snapshotRestore":
      return Snapshot.restore().then(() => ({ success: true }));

    case "snapshotExists":
      return Snapshot.exists().then(s => ({
        exists: !!s,
        savedAt: s ? s.savedAt : null,
        windowCount: s ? s.windows.length : 0,
        tabCount: s ? s.windows.reduce((sum, w) => sum + w.tabs.length, 0) : 0
      }));

    case "snapshotClear":
      return Snapshot.clear().then(() => ({ success: true }));

    default:
      return Promise.resolve({ error: "Unknown action" });
  }
});

/**
 * Get ungrouped tabs across all windows (excluding extension pages).
 */
async function getUngroupedTabs() {
  const tabs = await browser.tabs.query({});
  const extensionOrigin = browser.runtime.getURL("");
  const allAges = await TabAge.getAges(
    tabs.filter(t => t.url).map(t => t.url)
  );

  return tabs
    .filter(t =>
      !t.pinned &&
      (t.groupId === -1 || t.groupId === undefined) &&
      (!t.url || !t.url.startsWith(extensionOrigin))
    )
    .map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      favIconUrl: t.favIconUrl,
      active: t.active,
      age: allAges[t.url] || null
    }));
}

/**
 * Sort tabs within a group by age.
 */
async function handleSortByAge(groupId, direction = "oldest") {
  if (groupId === null) return { success: false, error: "Cannot sort ungrouped tabs" };

  const tabs = await browser.tabs.query({ groupId });
  const urls = tabs.map(t => t.url).filter(Boolean);
  const ages = await TabAge.getAges(urls);

  const sorted = [...tabs].sort((a, b) => {
    const ageA = ages[a.url] || Date.now();
    const ageB = ages[b.url] || Date.now();
    return direction === "oldest" ? ageA - ageB : ageB - ageA;
  });

  for (let i = 0; i < sorted.length; i++) {
    await browser.tabs.move(sorted[i].id, { index: -1 });
    await browser.tabs.group({ tabIds: [sorted[i].id], groupId });
  }

  return { success: true };
}
