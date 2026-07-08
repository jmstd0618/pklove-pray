const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const KOREAN_COLLATOR = new Intl.Collator("ko-KR", { sensitivity: "base" });

export const DEFAULT_SETTINGS = {
  title: "릴레이 금식기도 신청",
  description: "함께 기도로 준비하는 시간입니다.",
  startDate: "2026-07-01",
  endDate: "2026-07-15",
  excludedWeekdays: [],
  defaultCapacity: 5,
  capacities: {},
  roster: [],
  adminPassword: "0000",
};

export function mergeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    excludedWeekdays: Array.isArray(settings.excludedWeekdays)
      ? settings.excludedWeekdays.map(Number)
      : [],
    capacities: settings.capacities || {},
    roster: Array.isArray(settings.roster) ? settings.roster : [],
    adminPassword: settings.adminPassword || DEFAULT_SETTINGS.adminPassword,
  };
}

export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildDateRange(startDate, endDate, excludedWeekdays = []) {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const excluded = new Set(excludedWeekdays.map(Number));
  const days = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const dowIdx = cursor.getDay();
    if (excluded.has(dowIdx)) continue;
    const key = toDateKey(cursor);
    days.push({
      key,
      dom: cursor.getDate(),
      dow: DOW[dowIdx],
      dowIdx,
      label: `${cursor.getMonth() + 1}/${cursor.getDate()}(${DOW[dowIdx]})`,
    });
  }
  return days;
}

export function getCapacity(settings, dateKey) {
  const merged = mergeSettings(settings);
  const defaultCap = Number(merged.defaultCapacity);
  return Number.isFinite(defaultCap) && defaultCap > 0 ? defaultCap : DEFAULT_SETTINGS.defaultCapacity;
}

export function getEntriesForDate(registrations = {}, dateKey) {
  return Object.entries(registrations?.[dateKey]?.entries || {}).map(([id, entry]) => ({
    id,
    ...entry,
  }));
}

export function getNamesForDate(registrations = {}, dateKey) {
  return getEntriesForDate(registrations, dateKey)
    .map((entry) => entry.name)
    .filter(Boolean)
    .sort((a, b) => KOREAN_COLLATOR.compare(a, b));
}

export function hasNameOnDate(registrations = {}, dateKey, name = "") {
  return getNamesForDate(registrations, dateKey).includes(String(name || "").trim());
}

export function getDateKeysForName(registrations = {}, name = "") {
  const target = String(name || "").trim();
  if (!target) return [];
  return Object.entries(registrations || {})
    .filter(([, dateBucket]) => Object.values(dateBucket?.entries || {}).some((entry) => entry?.name === target))
    .map(([dateKey]) => dateKey)
    .sort();
}

export function isDateFull(entriesOrNames, settings, dateKey) {
  return entriesOrNames.length >= getCapacity(settings, dateKey);
}

export function normalizeRoster(textOrList) {
  const list = Array.isArray(textOrList) ? textOrList : String(textOrList || "").split(/\r?\n|,/);
  const seen = new Set();
  const names = [];
  list.forEach((raw) => {
    const name = String(raw || "").trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  });
  return names.sort((a, b) => KOREAN_COLLATOR.compare(a, b));
}

export function getRegisteredNames(registrations = {}) {
  const names = new Set();
  Object.values(registrations || {}).forEach((dateBucket) => {
    Object.values(dateBucket?.entries || {}).forEach((entry) => {
      if (entry?.name) names.add(entry.name);
    });
  });
  return names;
}

export function getUnregisteredNames(roster = [], registrations = {}) {
  const registered = getRegisteredNames(registrations);
  return normalizeRoster(roster).filter((name) => !registered.has(name));
}
