/**
 * Toolbar popup — snapshot, focus mode, slot assignment, import/export, triage launcher.
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

  // --- Slot assignments ---
  const slotsList = document.getElementById("slots-list");

  async function refreshSlots() {
    const [assignments, allGroups] = await Promise.all([
      msg({ action: "getSlotAssignments" }),
      msg({ action: "getAllGroups" })
    ]);

    slotsList.innerHTML = "";

    for (const entry of assignments) {
      const row = document.createElement("div");
      row.className = "slot-row";

      // Key badge
      const badge = document.createElement("span");
      badge.className = "slot-key";
      badge.textContent = entry.slot === 10 ? "0" : String(entry.slot);
      badge.title = `Ctrl+Shift+${badge.textContent}`;
      row.appendChild(badge);

      // Group selector
      const select = document.createElement("select");
      select.className = "slot-select";

      // "Unassigned" option
      const emptyOpt = document.createElement("option");
      emptyOpt.value = "";
      emptyOpt.textContent = "— unassigned —";
      select.appendChild(emptyOpt);

      // One option per existing group
      for (const group of allGroups) {
        const opt = document.createElement("option");
        opt.value = group.id;
        const slotLabel = group.assignedSlot ? ` [${group.assignedSlot === 10 ? "0" : group.assignedSlot}]` : "";
        opt.textContent = `${group.title} (${group.tabCount})${slotLabel}`;
        if (entry.groupId === group.id) opt.selected = true;
        select.appendChild(opt);
      }

      select.addEventListener("change", async () => {
        if (select.value) {
          await msg({ action: "assignSlot", slotNumber: entry.slot, groupId: parseInt(select.value) });
        } else {
          await msg({ action: "unassignSlot", slotNumber: entry.slot });
        }
        await refreshSlots();
      });

      row.appendChild(select);

      // Tab count
      if (entry.groupId) {
        const count = document.createElement("span");
        count.className = "slot-count";
        count.textContent = `${entry.tabCount}`;
        row.appendChild(count);
      }

      slotsList.appendChild(row);

      // Bulk close row for assigned groups with tabs
      if (entry.groupId && entry.tabCount > 0) {
        const bulkRow = document.createElement("div");
        bulkRow.className = "bulk-close-row";
        bulkRow.innerHTML = `Close older than <input type="number" min="0" value="30"> days `;

        const sortBtn = document.createElement("button");
        sortBtn.textContent = "Sort";
        sortBtn.className = "sort-btn";
        sortBtn.title = "Sort by age";
        let dir = "oldest";
        sortBtn.addEventListener("click", async () => {
          await msg({ action: "sortByAge", groupId: entry.groupId, direction: dir });
          dir = dir === "oldest" ? "newest" : "oldest";
        });
        bulkRow.appendChild(sortBtn);

        const closeBtn = document.createElement("button");
        closeBtn.textContent = "Close";
        closeBtn.addEventListener("click", async () => {
          const days = parseInt(bulkRow.querySelector("input").value) || 0;
          await msg({ action: "bulkCloseOlderThan", groupId: entry.groupId, days });
          await refreshSlots();
        });
        bulkRow.appendChild(closeBtn);
        slotsList.appendChild(bulkRow);
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
      await refreshSlots();
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
  await refreshSlots();
  await refreshUngroupedCount();
})();
