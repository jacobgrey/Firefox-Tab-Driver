/**
 * Toolbar popup — snapshot, focus mode, group overview, import/export, triage launcher.
 */
(async () => {
  const msg = browser.runtime.sendMessage;

  // --- Snapshot ---
  const snapshotStatus = document.getElementById("snapshot-status");
  const snapshotSaveBtn = document.getElementById("btn-snapshot-save");
  const snapshotRestoreBtn = document.getElementById("btn-snapshot-restore");
  const snapshotClearBtn = document.getElementById("btn-snapshot-clear");

  async function refreshSnapshot() {
    const info = await msg({ action: "snapshotExists" });
    if (info.exists) {
      const d = new Date(info.savedAt);
      snapshotStatus.textContent =
        `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ` +
        `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — ` +
        `${info.windowCount} win, ${info.tabCount} tabs`;
      snapshotRestoreBtn.disabled = false;
      snapshotClearBtn.disabled = false;
    } else {
      snapshotStatus.textContent = "No snapshot saved";
      snapshotRestoreBtn.disabled = true;
      snapshotClearBtn.disabled = true;
    }
  }

  snapshotSaveBtn.addEventListener("click", async () => {
    snapshotSaveBtn.disabled = true;
    snapshotStatus.textContent = "Saving...";
    await msg({ action: "snapshotSave" });
    await refreshSnapshot();
    snapshotSaveBtn.disabled = false;
  });

  snapshotRestoreBtn.addEventListener("click", async () => {
    if (!confirm("Restore snapshot? All current windows/tabs will be replaced.")) return;
    snapshotRestoreBtn.disabled = true;
    snapshotStatus.textContent = "Restoring...";
    await msg({ action: "snapshotRestore" });
  });

  snapshotClearBtn.addEventListener("click", async () => {
    await msg({ action: "snapshotClear" });
    await refreshSnapshot();
  });

  // --- Focus mode ---
  const focusBtn = document.getElementById("btn-focus");
  const focusStatus = document.getElementById("focus-status");

  async function refreshFocus() {
    const result = await msg({ action: "isFocusModeActive" });
    focusStatus.textContent = result.focusModeActive ? "Active" : "";
    focusBtn.textContent = result.focusModeActive ? "Exit Focus" : "Enter Focus";
  }

  focusBtn.addEventListener("click", async () => {
    await msg({ action: "toggleFocus" });
    await refreshFocus();
  });

  // --- Groups ---
  const groupsList = document.getElementById("groups-list");

  async function refreshGroups() {
    const groups = await msg({ action: "getGroups" });

    groupsList.innerHTML = "";
    for (const group of groups) {
      const row = document.createElement("div");
      row.className = "group-row";

      // Shortcut badge
      if (group.managedIndex) {
        const badge = document.createElement("span");
        badge.className = "group-shortcut";
        badge.textContent = group.managedIndex === 10 ? "0" : String(group.managedIndex);
        badge.title = `Ctrl+Shift+${badge.textContent}`;
        row.appendChild(badge);
      }

      const name = document.createElement("span");
      name.className = "group-name";
      name.textContent = group.title;
      row.appendChild(name);

      const count = document.createElement("span");
      count.className = "group-count";
      count.textContent = `${group.tabs.length} tabs`;
      row.appendChild(count);

      // Actions
      if (group.id !== null && group.tabs.length > 0) {
        const actions = document.createElement("div");
        actions.className = "group-actions";

        const sortBtn = document.createElement("button");
        sortBtn.textContent = "Sort";
        sortBtn.title = "Sort by age";
        let dir = "oldest";
        sortBtn.addEventListener("click", async () => {
          await msg({ action: "sortByAge", groupId: group.id, direction: dir });
          dir = dir === "oldest" ? "newest" : "oldest";
          await refreshGroups();
        });
        actions.appendChild(sortBtn);

        row.appendChild(actions);

        groupsList.appendChild(row);

        // Bulk close row
        const bulkRow = document.createElement("div");
        bulkRow.className = "bulk-close-row";
        bulkRow.innerHTML = `Close older than <input type="number" min="0" value="30"> days `;
        const closeBtn = document.createElement("button");
        closeBtn.textContent = "Close";
        closeBtn.addEventListener("click", async () => {
          const days = parseInt(bulkRow.querySelector("input").value) || 0;
          await msg({ action: "bulkCloseOlderThan", groupId: group.id, days });
          await refreshGroups();
        });
        bulkRow.appendChild(closeBtn);
        groupsList.appendChild(bulkRow);
      } else {
        groupsList.appendChild(row);
      }
    }
  }

  // --- Import/Export ---
  document.getElementById("btn-export").addEventListener("click", async () => {
    const data = await msg({ action: "exportAll" });
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tab-driver-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("btn-import").addEventListener("click", () => {
    document.getElementById("import-file").click();
  });

  document.getElementById("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await msg({ action: "importAll", data });
      await refreshGroups();
    } catch (err) {
      console.error("Import failed:", err);
    }
    e.target.value = "";
  });

  // --- Triage launcher ---
  const triageBtn = document.getElementById("btn-triage");
  const ungroupedCount = document.getElementById("ungrouped-count");

  triageBtn.addEventListener("click", async () => {
    await browser.windows.create({
      url: browser.runtime.getURL("triage/triage.html"),
      type: "popup",
      width: 420,
      height: 520
    });
    window.close();
  });

  async function refreshUngroupedCount() {
    const tabs = await msg({ action: "getUngroupedTabs" });
    ungroupedCount.textContent = `${tabs.length} ungrouped`;
  }

  // --- Init ---
  await refreshSnapshot();
  await refreshFocus();
  await refreshGroups();
  await refreshUngroupedCount();
})();
