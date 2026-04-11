# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Firefox WebExtension (Manifest V2, persistent background) for tab management. Targets Firefox 139+ for the native `browser.tabGroups` API. No build step, no bundler, no tests — load directly via `about:debugging`.

## Loading and Testing

Load as a temporary add-on: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on" → select `extension/manifest.json`. Click "Reload" after file edits.

## Architecture

### Background Script Load Order (Critical)

MV2 concatenates background scripts into one context. Order in `manifest.json` defines initialization order and must satisfy dependencies:

1. `extension/shared/storage-keys.js` — Storage key constants (consumed by everything)
2. `extension/background/config.js` — `MAX_LOADED_TABS`, `NUM_SLOTS`, `UNSORTED_GROUP_NAME`
3. `extension/background/tab-age.js` — `TabAge` module
4. `extension/background/tab-memory.js` — `TabMemory` module (depends on config, StorageKeys, TabPriority removed)
5. `extension/background/tab-groups.js` — `TabGroups` module (depends on config, StorageKeys)
6. `extension/background/focus-mode.js` — `FocusMode` module (depends on TabGroups)
7. `extension/background/import-export.js` — `ImportExport` module (depends on TabGroups, TabAge, TabMemory)
8. `extension/background/snapshot.js` — `Snapshot` module (depends on TabMemory, TabGroups)
9. `extension/background/main.js` — Entry point, wires listeners and message router (depends on all above)

Each module is an IIFE returning a public API object (e.g., `const TabGroups = (() => { ... return { init, moveTabToGroup, ... }; })();`).

### Communication Pattern

Background ↔ UI pages communicate via `browser.runtime.sendMessage`. The background's `onMessage` listener in `main.js` is the single message router. All messages use `{ action: "name", ...params }` format and return Promises.

Popup (`extension/popup/`) and triage (`extension/triage/`) are separate extension pages — they share `storage-keys.js` via `<script>` tags but have no direct access to background module globals.

### Slot-Based Group Assignment

The extension does NOT own or name groups. It maps 10 keyboard slots to Firefox group IDs, stored as `config:groupAssignments → { "1": groupId, "2": groupId, ... }`. Users create/name groups via Firefox's native UI, then assign them to slots in the popup dropdown. Pressing an unassigned slot auto-creates a new group.

### Pinned Tab Exemption

Pinned tabs are excluded from ALL group operations: `moveTabToGroup` returns early, `getUngroupedTabs` filters them out, focus mode skips them, triage never shows them. They ARE still subject to memory enforcement (discarding).

### Memory Enforcement

`TabMemory.enforce()` is serialized (one-at-a-time with pending queue) and suspendable. Import and snapshot restore call `suspend()`/`resume()` to prevent enforcement during bulk tab creation. The LRU list (`activationOrder`) tracks tab activation recency.

### Sort Locking

`handleSortByAge` uses a per-group `Set` lock (`sortingGroups`). Tabs are reordered with a single `tabs.move(reversedIds, { index: groupStart })` call to keep tabs within the group's index range (prevents group deletion from emptying).

## Storage Schema

- `age:{url}` — First-seen timestamp (ms)
- `config:maxLoadedTabs` — Override for `MAX_LOADED_TABS`
- `config:groupAssignments` — `{ slotNumber: firefoxGroupId }`
- `config:focusModeActive` — Boolean
- `snapshot:browserState` — Full browser state object (includes `slotAssignments` for remapping on restore)

## Keyboard Shortcuts

`Ctrl+Shift+1`–`Ctrl+Shift+0` (group slots), `Ctrl+Shift+F` (focus), `Ctrl+Shift+U` (triage). Defined as `commands` in manifest — the background listener in `main.js` dispatches them.

Triage popup uses bare `1`–`0`, `Space`, `X` keys (no modifier) since it's a focused extension page.
