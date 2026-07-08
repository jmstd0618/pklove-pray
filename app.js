import {
  DEFAULT_SETTINGS,
  buildDateRange,
  getCapacity,
  getDateKeysForName,
  getEntriesForDate,
  getNamesForDate,
  getUnregisteredNames,
  hasNameOnDate,
  mergeSettings,
  normalizeRoster,
} from "./app-core.js";

const firebaseConfig = {
  apiKey: "AIzaSyDkBl4qGUXVpc5JdYrHBxhINKLF8nDtQCk",
  authDomain: "pklove-pray.firebaseapp.com",
  databaseURL: "https://pklove-pray-default-rtdb.firebaseio.com/",
  projectId: "pklove-pray",
  storageBucket: "pklove-pray.firebasestorage.app",
  messagingSenderId: "481865284551",
  appId: "1:481865284551:web:c8d88e11f05c6a3fb1f7e2",
};

const ROOT = "pklovePray";
const CONFIGURED = !firebaseConfig.apiKey.startsWith("YOUR_");
const LS_KEY = "pklove-pray-local";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

let store;
let view = "form";
let settings = mergeSettings();
let registrations = {};
let selectedName = "";
let selectedDates = new Set();
let formMessage = "";
let formError = "";
let adminAuthed = false;
let adminError = "";
let adminNotice = "";
let adminActionError = "";
let saving = false;

const appEl = document.getElementById("app");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function makeId() {
  return `e${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

function allDays() {
  return buildDateRange(settings.startDate, settings.endDate, settings.excludedWeekdays);
}

function entriesFor(dateKey) {
  return getEntriesForDate(registrations, dateKey);
}

function loadLocalRoot() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    return {
      settings: mergeSettings(parsed.settings || DEFAULT_SETTINGS),
      registrations: parsed.registrations || {},
    };
  } catch (_) {
    return { settings: mergeSettings(), registrations: {} };
  }
}

function saveLocalRoot(root) {
  localStorage.setItem(LS_KEY, JSON.stringify(root));
}

function monthTitle(year, monthIndex) {
  return `${year}년 ${monthIndex + 1}월`;
}

function groupDaysByMonth(days) {
  return days.reduce((groups, day) => {
    const date = new Date(`${day.key}T00:00:00`);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!groups.has(monthKey)) {
      groups.set(monthKey, {
        title: monthTitle(date.getFullYear(), date.getMonth()),
        year: date.getFullYear(),
        monthIndex: date.getMonth(),
        days: new Map(),
      });
    }
    groups.get(monthKey).days.set(day.key, day);
    return groups;
  }, new Map());
}

function dateKeyFromParts(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function syncNameRegistrations(regs = {}, mergedSettings, name, targetDateKeys) {
  const targets = new Set(targetDateKeys);
  const nextRegistrations = {};

  Object.entries(regs || {}).forEach(([dateKey, dateBucket]) => {
    const nextEntries = {};
    Object.entries(dateBucket?.entries || {}).forEach(([entryId, entry]) => {
      if (entry?.name !== name) nextEntries[entryId] = entry;
    });
    nextRegistrations[dateKey] = { entries: nextEntries };
  });

  for (const dateKey of targets) {
    const withoutNameEntries = nextRegistrations[dateKey]?.entries || {};
    const existingNames = Object.values(withoutNameEntries).map((entry) => entry.name).filter(Boolean);
    if (existingNames.length >= getCapacity(mergedSettings, dateKey)) throw new Error("full");
  }

  targets.forEach((dateKey) => {
    nextRegistrations[dateKey] = {
      entries: {
        ...(nextRegistrations[dateKey]?.entries || {}),
        [makeId()]: { name, createdAt: new Date().toLocaleString("ko-KR") },
      },
    };
  });

  return nextRegistrations;
}

async function createLocalStore() {
  let root = loadLocalRoot();
  settings = mergeSettings(root.settings);
  registrations = root.registrations || {};
  return {
    mode: "local",
    async saveSettings(nextSettings) {
      root = { ...root, settings: mergeSettings({ ...nextSettings, capacities: {} }) };
      settings = root.settings;
      saveLocalRoot(root);
      render();
    },
    async register(name, dateKeys) {
      root = loadLocalRoot();
      const merged = mergeSettings(root.settings);
      const regs = root.registrations || {};
      const keys = Array.isArray(dateKeys) ? dateKeys : [dateKeys];
      const nextRegistrations = syncNameRegistrations(regs, merged, name, keys);
      root = {
        settings: merged,
        registrations: nextRegistrations,
      };
      settings = root.settings;
      registrations = root.registrations;
      saveLocalRoot(root);
      render();
    },
    async deleteEntry(dateKey, entryId) {
      root = loadLocalRoot();
      const dateBucket = root.registrations?.[dateKey] || { entries: {} };
      const nextEntries = { ...(dateBucket.entries || {}) };
      delete nextEntries[entryId];
      root.registrations = {
        ...(root.registrations || {}),
        [dateKey]: { entries: nextEntries },
      };
      settings = mergeSettings(root.settings);
      registrations = root.registrations;
      saveLocalRoot(root);
      render();
    },
  };
}

async function createFirebaseStore() {
  const [{ initializeApp }, { getDatabase, onValue, ref, runTransaction, set }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"),
  ]);
  const firebaseApp = initializeApp(firebaseConfig);
  const db = getDatabase(firebaseApp);
  const rootRef = ref(db, ROOT);

  onValue(rootRef, (snapshot) => {
    const root = snapshot.val() || {};
    settings = mergeSettings(root.settings || DEFAULT_SETTINGS);
    registrations = root.registrations || {};
    render();
  });

  return {
    mode: "firebase",
    async saveSettings(nextSettings) {
      await set(ref(db, `${ROOT}/settings`), mergeSettings({ ...nextSettings, capacities: {} }));
    },
    async register(name, dateKeys) {
      let reason = "";
      const keys = Array.isArray(dateKeys) ? dateKeys : [dateKeys];
      const result = await runTransaction(rootRef, (root) => {
        const data = root || {};
        const merged = mergeSettings(data.settings || DEFAULT_SETTINGS);
        const regs = data.registrations || {};
        let nextRegistrations;
        try {
          nextRegistrations = syncNameRegistrations(regs, merged, name, keys);
        } catch (error) {
          reason = error.message || "failed";
          return;
        }
        return {
          ...data,
          settings: merged,
          registrations: nextRegistrations,
        };
      });
      if (!result.committed) throw new Error(reason || "failed");
    },
    async deleteEntry(dateKey, entryId) {
      await runTransaction(rootRef, (root) => {
        if (!root) return root;
        const nextEntries = { ...(root.registrations?.[dateKey]?.entries || {}) };
        delete nextEntries[entryId];
        return {
          ...root,
          registrations: {
            ...(root.registrations || {}),
            [dateKey]: { entries: nextEntries },
          },
        };
      });
    },
  };
}

function renderHeader() {
  return `
    <header class="hero">
      <div class="mark">+</div>
      <h1>${escapeHtml(settings.title)}</h1>
      <p class="desc">${escapeHtml(settings.description)}</p>
      ${CONFIGURED ? "" : `<p class="notice">Firebase 설정 전이라 현재 브라우저의 localStorage로 동작합니다. 배포 전 app.js의 firebaseConfig를 교체해 주세요.</p>`}
    </header>
  `;
}

function renderTabs() {
  return `
    <nav class="tabs">
      <button class="tab ${view === "form" ? "on" : ""}" data-view="form">신청</button>
      <button class="tab ${view === "schedule" ? "on" : ""}" data-view="schedule">전체 일정표</button>
      <button class="tab ${view === "admin" ? "on" : ""}" data-view="admin">관리자</button>
    </nav>
  `;
}

function renderForm() {
  const roster = normalizeRoster(settings.roster);
  const days = allDays();

  return `
    <section class="panel">
      <h2 class="section-title">금식 날짜 신청</h2>
      <p class="muted">명단에서 이름을 선택하면 현재 신청 날짜가 표시됩니다. 날짜를 추가하거나 선택 해제한 뒤 저장하세요.</p>
      ${roster.length ? "" : `<p class="notice">아직 관리자 명단이 없습니다. 관리자 페이지에서 전체 인원을 먼저 등록해 주세요.</p>`}
      <div class="field">
        <span class="label">이름 선택</span>
        ${renderRosterPicker(roster)}
        <div class="muted small">전체 명단 ${roster.length}명</div>
      </div>
    </section>

    <section class="panel">
      <h2 class="section-title">날짜 선택</h2>
      ${days.length ? renderDateCalendar(days) : `<p class="notice">신청 가능한 날짜가 없습니다. 관리자 페이지에서 기간과 제외 요일을 확인해 주세요.</p>`}
      ${renderSelectedDates()}
    </section>

    ${formError ? `<div class="error">${escapeHtml(formError)}</div>` : ""}
    ${formMessage ? `<div class="success">${escapeHtml(formMessage)}</div>` : ""}

    <button id="submit" class="btn" ${saving ? "disabled" : ""}>${saving ? "저장 중..." : "신청/수정 저장하기"}</button>
  `;
}

function renderRosterPicker(names) {
  if (!names.length) {
    return `<div class="name-picker-empty">등록된 명단이 없습니다.</div>`;
  }
  return `
    <div class="name-picker">
      ${names.map((name) => `
        <button type="button" class="name-choice ${selectedName === name ? "on" : ""}" data-name="${escapeHtml(name)}">
          ${escapeHtml(name)}
        </button>
      `).join("")}
    </div>
    ${renderSelectedName()}
  `;
}

function renderSelectedName() {
  return selectedName
    ? `<div class="selected-name">선택된 이름 <strong>${escapeHtml(selectedName)}</strong></div>`
    : `<div class="selected-name muted">명단에서 이름을 선택해 주세요.</div>`;
}

function renderSelectedDates() {
  const selected = selectedDateList();
  if (!selected.length) return "";
  return `
    <div class="selected-dates">
      선택한 날짜
      ${selected.map((day) => `<strong>${escapeHtml(day.label)}</strong>`).join("")}
    </div>
  `;
}

function selectedDateList() {
  return allDays().filter((day) => selectedDates.has(day.key));
}

function selectedDateKeys() {
  return selectedDateList().map((day) => day.key);
}

function toggleSelectedDate(dateKey) {
  if (selectedDates.has(dateKey)) selectedDates.delete(dateKey);
  else selectedDates.add(dateKey);
}

function renderDateCalendar(days) {
  return renderMonthCalendars(days, renderCalendarCell);
}

function renderScheduleCalendar(days) {
  return renderMonthCalendars(days, renderScheduleCalendarCell, "schedule-calendar");
}

function renderAdminCalendar(days) {
  return renderMonthCalendars(days, renderAdminCalendarCell, "admin-calendar");
}

function renderMonthCalendars(days, cellRenderer, extraClass = "") {
  const monthGroups = Array.from(groupDaysByMonth(days).values());
  return monthGroups.map((month) => {
    const firstDow = new Date(month.year, month.monthIndex, 1).getDay();
    const lastDate = new Date(month.year, month.monthIndex + 1, 0).getDate();
    const rawCells = [];

    for (let i = 0; i < firstDow; i += 1) {
      rawCells.push({ active: false, html: `<div class="cal-cell blank"></div>` });
    }

    for (let dom = 1; dom <= lastDate; dom += 1) {
      const key = dateKeyFromParts(month.year, month.monthIndex, dom);
      rawCells.push({
        active: month.days.has(key),
        html: cellRenderer(month.days.get(key), dom),
      });
    }

    while (rawCells.length % 7 !== 0) {
      rawCells.push({ active: false, html: `<div class="cal-cell blank"></div>` });
    }

    const cells = [];
    for (let i = 0; i < rawCells.length; i += 7) {
      const week = rawCells.slice(i, i + 7);
      if (week.some((cell) => cell.active)) cells.push(...week.map((cell) => cell.html));
    }
    return `
      <div class="calendar-block">
        <div class="calendar-title">${escapeHtml(month.title)}</div>
        <div class="calendar-weekdays">${WEEKDAYS.map((day) => `<span>${day}</span>`).join("")}</div>
        <div class="calendar-grid ${extraClass}">${cells.join("")}</div>
      </div>
    `;
  }).join("");
}

function renderCalendarCell(day, fallbackDom) {
  if (!day) {
    return `<div class="cal-cell inactive"><span class="cal-dom">${fallbackDom}</span></div>`;
  }
  const count = entriesFor(day.key).length;
  const cap = getCapacity(settings, day.key);
  const full = count >= cap;
  const selected = selectedDates.has(day.key);
  const already = !!selectedName && hasNameOnDate(registrations, day.key, selectedName);
  const disabled = full && !already;
  return `
    <button class="cal-cell active ${selected ? "on" : ""} ${disabled ? "full" : ""}" data-date="${day.key}" ${disabled ? "disabled" : ""}>
      <span class="cal-dom ${day.dowIdx === 0 ? "sun" : day.dowIdx === 6 ? "sat" : ""}">${day.dom}</span>
      <span class="cal-count">${count}/${cap}</span>
      <span class="cal-state">${selected && already ? "신청됨" : selected ? "선택됨" : full ? "마감" : `${cap - count}명 가능`}</span>
    </button>
  `;
}

function renderScheduleCalendarCell(day, fallbackDom) {
  if (!day) {
    return `<div class="cal-cell inactive"><span class="cal-dom">${fallbackDom}</span></div>`;
  }
  const names = getNamesForDate(registrations, day.key);
  const cap = getCapacity(settings, day.key);
  const full = names.length >= cap;
  return `
    <div class="cal-cell schedule-cell ${full ? "full" : ""}">
      <span class="cal-dom ${day.dowIdx === 0 ? "sun" : day.dowIdx === 6 ? "sat" : ""}">${day.dom}</span>
      <span class="cal-count">${names.length}/${cap}${full ? " 마감" : ""}</span>
      ${names.length
        ? `<div class="schedule-names">${names.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>`
        : `<div class="schedule-names empty">-</div>`}
    </div>
  `;
}

function renderAdminCalendarCell(day, fallbackDom) {
  if (!day) {
    return `<div class="cal-cell inactive"><span class="cal-dom">${fallbackDom}</span></div>`;
  }
  const entries = entriesFor(day.key).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko-KR"));
  const cap = getCapacity(settings, day.key);
  return `
    <div class="cal-cell schedule-cell admin-cell">
      <span class="cal-dom ${day.dowIdx === 0 ? "sun" : day.dowIdx === 6 ? "sat" : ""}">${day.dom}</span>
      <span class="cal-count">${entries.length}/${cap}</span>
      ${entries.length
        ? `<div class="schedule-names admin-names">${entries.map((entry) => `
          <span>
            ${escapeHtml(entry.name)}
            <button data-delete-date="${day.key}" data-delete-id="${entry.id}" title="삭제" aria-label="${escapeHtml(entry.name)} 신청 삭제">x</button>
          </span>
        `).join("")}</div>`
        : `<div class="schedule-names empty">-</div>`}
    </div>
  `;
}

function renderSchedule() {
  const days = allDays();
  const unregistered = getUnregisteredNames(settings.roster, registrations);
  return `
    <section class="panel">
      <h2 class="section-title">전체 일정표</h2>
      ${days.length ? renderScheduleCalendar(days) : `<p class="notice">표시할 일정이 없습니다. 관리자 페이지에서 기간과 제외 요일을 확인해 주세요.</p>`}
    </section>
    <section class="panel">
      <h2 class="section-title">미신청자</h2>
      ${unregistered.length ? `<div class="unregistered">${unregistered.map((name) => `<span class="chip">${escapeHtml(name)}</span>`).join("")}</div>` : `<p class="success">전체 명단이 모두 신청했습니다.</p>`}
    </section>
  `;
}

function renderAdminLogin() {
  return `
    <section class="panel">
      <h2 class="section-title">관리자 로그인</h2>
      <div class="field">
        <label for="admin-pw">비밀번호</label>
        <input id="admin-pw" class="input" type="password" placeholder="비밀번호">
        ${adminError ? `<div class="error">${escapeHtml(adminError)}</div>` : ""}
      </div>
      <button id="admin-login" class="btn">로그인</button>
    </section>
  `;
}

function renderAdmin() {
  if (!adminAuthed) return renderAdminLogin();
  const days = allDays();
  return `
    <section class="panel">
      <div class="admin-top">
        <h2>관리자 페이지</h2>
        <button id="admin-logout" class="btn secondary">로그아웃</button>
      </div>
      ${adminNotice ? `<div class="admin-feedback ok">${escapeHtml(adminNotice)}</div>` : ""}
      ${adminActionError ? `<div class="admin-feedback bad">${escapeHtml(adminActionError)}</div>` : ""}
      <div class="row">
        <div class="field">
          <label for="title">제목</label>
          <input id="title" class="input" value="${escapeHtml(settings.title)}">
        </div>
        <div class="field">
          <label for="default-capacity">기본 모집 인원</label>
          <input id="default-capacity" class="input" type="number" min="1" value="${escapeHtml(settings.defaultCapacity)}">
          <div class="muted small">모든 신청 가능 날짜에 동일하게 적용됩니다.</div>
        </div>
      </div>
      <div class="field">
        <label for="description">안내 문구</label>
        <input id="description" class="input" value="${escapeHtml(settings.description)}">
      </div>
      <div class="row">
        <div class="field">
          <label for="start-date">시작일</label>
          <input id="start-date" class="input" type="date" value="${escapeHtml(settings.startDate)}">
        </div>
        <div class="field">
          <label for="end-date">종료일</label>
          <input id="end-date" class="input" type="date" value="${escapeHtml(settings.endDate)}">
        </div>
      </div>
      <div class="field">
        <span class="label">제외 요일</span>
        <div class="weekday-list">
          ${WEEKDAYS.map((label, idx) => `
            <label><input type="checkbox" class="weekday" value="${idx}" ${settings.excludedWeekdays.includes(idx) ? "checked" : ""}>${label}</label>
          `).join("")}
        </div>
      </div>
      <div class="field">
        <label for="admin-password">관리자 비밀번호 변경</label>
        <input id="admin-password" class="input" type="password" value="${escapeHtml(settings.adminPassword)}">
      </div>
      <button id="save-settings" class="btn">기본 설정 저장</button>
    </section>

    <section class="panel">
      <h2 class="section-title">전체 인원 명단</h2>
      <p class="muted">한 줄에 한 명씩 입력하세요. 저장하면 중복과 빈 줄을 제거하고 가-하 순으로 정렬됩니다.</p>
      <textarea id="roster" class="textarea">${escapeHtml(normalizeRoster(settings.roster).join("\n"))}</textarea>
      <div class="actions">
        <button id="save-roster" class="btn">명단 저장</button>
        <span class="muted">현재 ${normalizeRoster(settings.roster).length}명</span>
      </div>
    </section>

    <section class="panel">
      <h2 class="section-title">신청자 관리</h2>
      ${days.length ? renderAdminCalendar(days) : `<p class="notice">관리할 일정이 없습니다. 기간과 제외 요일을 확인해 주세요.</p>`}
    </section>
  `;
}

function render() {
  appEl.innerHTML = renderHeader() + renderTabs() + (
    view === "schedule" ? renderSchedule() :
    view === "admin" ? renderAdmin() :
    renderForm()
  );
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      view = button.dataset.view;
      formError = "";
      formMessage = "";
      adminNotice = "";
      adminActionError = "";
      render();
    });
  });

  bindNameChoiceEvents();

  document.querySelectorAll("[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleSelectedDate(button.dataset.date);
      formError = "";
      render();
    });
  });

  const submit = document.getElementById("submit");
  if (submit) submit.addEventListener("click", handleSubmit);

  const login = document.getElementById("admin-login");
  if (login) login.addEventListener("click", handleAdminLogin);

  const adminPw = document.getElementById("admin-pw");
  if (adminPw) adminPw.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleAdminLogin();
  });

  const logout = document.getElementById("admin-logout");
  if (logout) logout.addEventListener("click", () => {
    adminAuthed = false;
    view = "form";
    render();
  });

  const saveSettings = document.getElementById("save-settings");
  if (saveSettings) saveSettings.addEventListener("click", handleSaveSettings);

  const saveRoster = document.getElementById("save-roster");
  if (saveRoster) saveRoster.addEventListener("click", handleSaveRoster);

  document.querySelectorAll("[data-delete-date]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("이 신청을 삭제할까요?")) return;
      try {
        await store.deleteEntry(button.dataset.deleteDate, button.dataset.deleteId);
        adminNotice = "신청을 삭제했습니다.";
        adminActionError = "";
        render();
      } catch (_) {
        adminNotice = "";
        adminActionError = "삭제 중 오류가 발생했습니다. 다시 시도해 주세요.";
        render();
      }
    });
  });
}

function bindNameChoiceEvents() {
  document.querySelectorAll("[data-name]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedName = button.dataset.name;
      selectedDates = new Set(getDateKeysForName(registrations, selectedName));
      formError = "";
      render();
    });
  });
}

async function handleSubmit() {
  formError = "";
  formMessage = "";
  const roster = normalizeRoster(settings.roster);
  if (!selectedName || !roster.includes(selectedName)) {
    formError = "명단에서 이름을 선택해 주세요.";
    render();
    return;
  }
  const dateKeys = selectedDateKeys();
  saving = true;
  render();
  try {
    await store.register(selectedName, dateKeys);
    const labels = selectedDateList().map((day) => day.label).join(", ");
    formMessage = labels
      ? `${selectedName} 님, ${labels} 신청 내용이 저장되었습니다.`
      : `${selectedName} 님의 신청 날짜가 모두 제거되었습니다.`;
    selectedName = "";
    selectedDates = new Set();
  } catch (error) {
    if (error.message === "full") formError = "선택한 날짜 중 방금 마감된 날짜가 있습니다. 날짜를 다시 선택해 주세요.";
    else formError = "저장 중 오류가 발생했습니다. 다시 시도해 주세요.";
  }
  saving = false;
  render();
}

function handleAdminLogin() {
  const input = document.getElementById("admin-pw");
  if (input?.value === settings.adminPassword) {
    adminAuthed = true;
    adminError = "";
  } else {
    adminError = "비밀번호가 올바르지 않습니다.";
  }
  render();
}

async function handleSaveSettings() {
  const excludedWeekdays = Array.from(document.querySelectorAll(".weekday:checked")).map((item) => Number(item.value));
  const next = mergeSettings({
    ...settings,
    title: document.getElementById("title").value.trim() || DEFAULT_SETTINGS.title,
    description: document.getElementById("description").value.trim(),
    startDate: document.getElementById("start-date").value || todayKey(),
    endDate: document.getElementById("end-date").value || todayKey(),
    excludedWeekdays,
    defaultCapacity: Math.max(1, Number(document.getElementById("default-capacity").value) || DEFAULT_SETTINGS.defaultCapacity),
    capacities: {},
    adminPassword: document.getElementById("admin-password").value || "0000",
  });
  try {
    await store.saveSettings(next);
    adminNotice = "기본 설정을 저장했습니다.";
    adminActionError = "";
    render();
  } catch (_) {
    adminNotice = "";
    adminActionError = "기본 설정 저장 중 오류가 발생했습니다.";
    render();
  }
}

async function handleSaveRoster() {
  const roster = normalizeRoster(document.getElementById("roster").value);
  try {
    await store.saveSettings({ ...settings, roster });
    adminNotice = `명단 ${roster.length}명을 저장하고 가-하 순으로 정렬했습니다.`;
    adminActionError = "";
    render();
  } catch (_) {
    adminNotice = "";
    adminActionError = "명단 저장 중 오류가 발생했습니다.";
    render();
  }
}

async function init() {
  store = CONFIGURED ? await createFirebaseStore() : await createLocalStore();
  if (store.mode === "local") render();
}

init().catch((error) => {
  appEl.innerHTML = `<div class="panel"><h1>초기화 오류</h1><p class="error">${escapeHtml(error.message)}</p></div>`;
});
