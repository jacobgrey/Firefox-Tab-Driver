/**
 * Storage key prefixes and helpers used by both background and UI scripts.
 */
const StorageKeys = {
  PREFIX_AGE: "age:",
  CONFIG_MAX_LOADED_TABS: "config:maxLoadedTabs",
  CONFIG_GROUP_ASSIGNMENTS: "config:groupAssignments",
  CONFIG_FOCUS_MODE_ACTIVE: "config:focusModeActive",

  ageKey(url) {
    return this.PREFIX_AGE + url;
  },

  isAgeKey(key) {
    return key.startsWith(this.PREFIX_AGE);
  },

  urlFromAgeKey(key) {
    return key.slice(this.PREFIX_AGE.length);
  }
};
