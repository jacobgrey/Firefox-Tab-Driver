/**
 * Triage popup — shows all ungrouped tabs in a list.
 * The top item is the current tab to sort. Press 1-9/0 to assign to a group,
 * Space to skip, X to close. Processed items are removed, sliding the next up.
 */
(async () => {
  const msg = browser.runtime.sendMessage;

  const tabListEl = document.getElementById("tab-list");
  const progress = document.getElementById("progress");
  const groupsGrid = document.getElementById("groups-grid");
  const actionsEl = document.getElementById("actions");
  const doneEl = document.getElementById("done-message");

  let ungroupedTabs = [];
  let currentIndex = 0;
  let totalCount = 0;
  let processedCount = 0;
  let slotAssignments = [];
  let groupButtons = [];

  function formatAge(timestamp) {
    if (!timestamp) return "";
    const ms = Date.now() - timestamp;
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(ms / 3600000);
    const days = Math.floor(ms / 86400000);
    const weeks = Math.floor(days / 7);
    if (days >= 14) return `${weeks}w`;
    if (days >= 1) return `${days}d`;
    if (hours >= 1) return `${hours}h`;
    if (minutes >= 1) return `${minutes}m`;
    return "new";
  }

  async function loadData() {
    [ungroupedTabs, slotAssignments] = await Promise.all([
      msg({ action: "getUngroupedTabs" }),
      msg({ action: "getSlotAssignments" })
    ]);
    currentIndex = 0;
    totalCount = ungroupedTabs.length;
    processedCount = 0;
  }

  function buildGroupGrid() {
    groupsGrid.innerHTML = "";
    groupButtons = [];

    for (const entry of slotAssignments) {
      const btn = document.createElement("button");
      btn.className = "group-btn";
      if (!entry.groupId) btn.classList.add("unassigned");

      const keySpan = document.createElement("span");
      keySpan.className = "key";
      keySpan.textContent = entry.slot === 10 ? "0" : String(entry.slot);
      btn.appendChild(keySpan);

      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = entry.title || "New group";
      btn.appendChild(nameSpan);

      btn.addEventListener("click", () => assignToGroup(entry.slot));
      groupsGrid.appendChild(btn);
      groupButtons.push(btn);
    }
  }

  function renderList() {
    tabListEl.innerHTML = "";

    if (currentIndex >= ungroupedTabs.length) {
      showDone();
      return;
    }

    const remaining = ungroupedTabs.length - currentIndex;
    progress.textContent = `${processedCount} done, ${remaining} left`;

    tabListEl.hidden = false;
    groupsGrid.hidden = false;
    actionsEl.hidden = false;
    doneEl.hidden = true;

    // Render visible tabs starting from currentIndex
    for (let i = currentIndex; i < ungroupedTabs.length; i++) {
      const tab = ungroupedTabs[i];
      const isCurrent = i === currentIndex;

      const row = document.createElement("div");
      row.className = "tab-row" + (isCurrent ? " current" : "");

      const favicon = document.createElement("img");
      favicon.className = "tab-favicon";
      favicon.src = tab.favIconUrl || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
      favicon.onerror = () => { favicon.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"; };
      row.appendChild(favicon);

      const info = document.createElement("div");
      info.className = "tab-info";

      const title = document.createElement("div");
      title.className = "tab-title";
      title.textContent = tab.title || tab.url || "New Tab";
      info.appendChild(title);

      const url = document.createElement("div");
      url.className = "tab-url";
      url.textContent = tab.url || "";
      info.appendChild(url);

      row.appendChild(info);

      const age = document.createElement("span");
      age.className = "tab-age";
      age.textContent = formatAge(tab.age);
      row.appendChild(age);

      tabListEl.appendChild(row);
    }

    // Scroll the current item into view
    const currentRow = tabListEl.querySelector(".current");
    if (currentRow) currentRow.scrollIntoView({ block: "nearest" });
  }

  function showDone() {
    tabListEl.hidden = true;
    groupsGrid.hidden = true;
    actionsEl.hidden = true;
    doneEl.hidden = false;
    progress.textContent = `${processedCount} done`;
  }

  function flashButton(index) {
    const btn = groupButtons[index];
    if (!btn) return;
    btn.classList.add("flash");
    setTimeout(() => btn.classList.remove("flash"), 150);
  }

  async function assignToGroup(groupIndex) {
    const tab = ungroupedTabs[currentIndex];
    if (!tab) return;

    flashButton(groupIndex - 1);
    try {
      await msg({ action: "moveTab", tabId: tab.id, groupIndex });
    } catch (e) {
      // Tab may have been closed since triage loaded; skip it
    }
    processedCount++;
    advance();
  }

  function skip() {
    advance();
  }

  async function closeTab() {
    const tab = ungroupedTabs[currentIndex];
    if (!tab) return;
    try {
      await browser.tabs.remove(tab.id);
    } catch (e) {
      // Already closed
    }
    processedCount++;
    ungroupedTabs.splice(currentIndex, 1);
    renderList();
  }

  function advance() {
    currentIndex++;
    renderList();
  }

  // --- Keyboard handler ---
  document.addEventListener("keydown", (e) => {
    if (currentIndex >= ungroupedTabs.length) return;
    if (e.target.tagName === "INPUT") return;

    const key = e.key;

    if (key >= "1" && key <= "9") {
      e.preventDefault();
      assignToGroup(parseInt(key));
    } else if (key === "0") {
      e.preventDefault();
      assignToGroup(10);
    } else if (key === " ") {
      e.preventDefault();
      skip();
    } else if (key === "x" || key === "X") {
      e.preventDefault();
      closeTab();
    }
  });

  document.getElementById("btn-done-close").addEventListener("click", () => window.close());
  document.getElementById("btn-skip").addEventListener("click", skip);
  document.getElementById("btn-close").addEventListener("click", closeTab);

  // --- Init ---
  await loadData();
  buildGroupGrid();
  renderList();
})();
