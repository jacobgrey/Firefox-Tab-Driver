/**
 * Triage popup — shows ungrouped tabs one at a time.
 * Press 1-9/0 to assign to a group, Space to skip, X to close the tab.
 * Auto-advances to the next ungrouped tab after each action.
 */
(async () => {
  const msg = browser.runtime.sendMessage;

  const tabFavicon = document.getElementById("tab-favicon");
  const tabTitle = document.getElementById("tab-title");
  const tabUrl = document.getElementById("tab-url");
  const tabAge = document.getElementById("tab-age");
  const progress = document.getElementById("progress");
  const groupsGrid = document.getElementById("groups-grid");
  const currentTabEl = document.getElementById("current-tab");
  const actionsEl = document.getElementById("actions");
  const doneEl = document.getElementById("done-message");

  let ungroupedTabs = [];
  let currentIndex = 0;
  let groupNames = [];
  let groupButtons = [];

  function formatAge(timestamp) {
    if (!timestamp) return "";
    const ms = Date.now() - timestamp;
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(ms / 3600000);
    const days = Math.floor(ms / 86400000);
    const weeks = Math.floor(days / 7);
    if (days >= 14) return `First seen ${weeks}w ago`;
    if (days >= 1) return `First seen ${days}d ago`;
    if (hours >= 1) return `First seen ${hours}h ago`;
    if (minutes >= 1) return `First seen ${minutes}m ago`;
    return "First seen just now";
  }

  async function loadData() {
    [ungroupedTabs, groupNames] = await Promise.all([
      msg({ action: "getUngroupedTabs" }),
      msg({ action: "getGroupNames" })
    ]);
    currentIndex = 0;
  }

  function buildGroupGrid() {
    groupsGrid.innerHTML = "";
    groupButtons = [];

    for (let i = 0; i < groupNames.length; i++) {
      const btn = document.createElement("button");
      btn.className = "group-btn";
      btn.innerHTML = `<span class="key">${i === 9 ? "0" : String(i + 1)}</span><span class="name">${groupNames[i]}</span>`;
      btn.addEventListener("click", () => assignToGroup(i + 1));
      groupsGrid.appendChild(btn);
      groupButtons.push(btn);
    }
  }

  function showCurrent() {
    if (currentIndex >= ungroupedTabs.length) {
      showDone();
      return;
    }

    const tab = ungroupedTabs[currentIndex];

    tabFavicon.src = tab.favIconUrl || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
    tabFavicon.onerror = () => { tabFavicon.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"; };
    tabTitle.textContent = tab.title || tab.url || "New Tab";

    try {
      tabUrl.textContent = tab.url;
    } catch {
      tabUrl.textContent = tab.url || "";
    }

    tabAge.textContent = formatAge(tab.age);
    progress.textContent = `${currentIndex + 1} / ${ungroupedTabs.length}`;

    currentTabEl.hidden = false;
    groupsGrid.hidden = false;
    actionsEl.hidden = false;
    doneEl.hidden = true;
  }

  function showDone() {
    currentTabEl.hidden = true;
    groupsGrid.hidden = true;
    actionsEl.hidden = true;
    doneEl.hidden = false;
    progress.textContent = "Done";
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
    await msg({ action: "moveTab", tabId: tab.id, groupIndex });
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
    // Remove from list rather than advancing index
    ungroupedTabs.splice(currentIndex, 1);
    // Don't increment — currentIndex now points to the next tab
    showCurrent();
  }

  function advance() {
    currentIndex++;
    showCurrent();
  }

  // --- Keyboard handler ---
  document.addEventListener("keydown", (e) => {
    if (currentIndex >= ungroupedTabs.length) return;

    // Don't capture in inputs
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

  // --- Close button in done state ---
  document.getElementById("btn-done-close").addEventListener("click", () => {
    window.close();
  });

  // --- Skip and Close buttons ---
  document.getElementById("btn-skip").addEventListener("click", skip);
  document.getElementById("btn-close").addEventListener("click", closeTab);

  // --- Init ---
  await loadData();
  buildGroupGrid();
  showCurrent();
})();
