import {
  DEFAULT_SETTINGS,
  buildDateRange,
  getCapacity,
  getEntriesForDate,
  getRegisteredNames,
  getUnregisteredNames,
  isDateFull,
  mergeSettings,
  normalizeRoster,
} from "./app-core.js";

const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
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
let nameQuery = "";
let selectedDate = "";
let formMessage = "";
let formError = "";
let adminAuthed = false;
let adminError = "";
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

function fullFor(dateKey) {
  return isDateFull(entriesFor(dateKey), settings, dateKey);
}

function rootFromState() {
  return {
    settings,
    registrations,
  };
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

async function createLocalStore() {
  let root = loadLocalRoot();
  settings = mergeSettings(root.settings);
  registrations = root.registrations || {};
  return {
    mode: "local",
    async saveSettings(nextSettings) {
      root = { ...root, settings: mergeSettings(nextSettings) };
      settings = root.settings;
      saveLocalRoot(root);
      render();
    },
    async register(name, dateKey) {
      root = loadLocalRoot();
      const merged = mergeSettings(root.settings);
      const regs = root.registrations || {};
      const registered = getRegisteredNames(regs);
      if (registered.has(name)) throw new Error("already");
      const entries = Object.values(regs[dateKey]?.entries || {});
      if (isDateFull(entries, merged, dateKey)) throw new Error("full");
      const nextEntries = {
        ...(regs[dateKey]?.entries || {}),
        [makeId()]: { name, createdAt: new Date().toLocaleString("ko-KR") },
      };
      root = {
        settings: merged,
        registrations: {
          ...regs,
          [dateKey]: { entries: nextEntries },
        },
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
      await set(ref(db, `${ROOT}/settings`), mergeSettings(nextSettings));
    },
    async register(name, dateKey) {
      let reason = "";
      const result = await runTransaction(rootRef, (root) => {
        const data = root || {};
        const merged = mergeSettings(data.settings || DEFAULT_SETTINGS);
        const regs = data.registrations || {};
        if (getRegisteredNames(regs).has(name)) {
          reason = "already";
          return;
        }
        const dateEntries = Object.values(regs[dateKey]?.entries || {});
        if (isDateFull(dateEntries, merged, dateKey)) {
          reason = "full";
          return;
        }
        const nextEntries = {
          ...(regs[dateKey]?.entries || {}),
          [makeId()]: { name, createdAt: new Date().toLocaleString("ko-KR") },
        };
        return {
          ...data,
          settings: merged,
          registrations: {
            ...regs,
            [dateKey]: { entries: nextEntries },
          },
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
  const registered = getRegisteredNames(registrations);
  const availableNames = roster.filter((name) => !registered.has(name));
  const filteredNames = availableNames.filter((name) => name.includes(nameQuery.trim()));
  const days = allDays();

  return `
    <section class="panel">
      <h2 class="section-title">금식 날짜 신청</h2>
      <p class="muted">관리자가 등록한 명단에서 이름을 선택한 뒤 가능한 날짜를 고르세요. 한 사람은 한 번만 신청할 수 있습니다.</p>
      ${roster.length ? "" : `<p class="notice">아직 관리자 명단이 없습니다. 관리자 페이지에서 전체 인원을 먼저 등록해 주세요.</p>`}
      <div class="field">
        <label for="name-query">이름 검색</label>
        <input id="name-query" class="input" value="${escapeHtml(nameQuery)}" placeholder="이름을 입력해 검색">
      </div>
      <div class="field">
        <label for="name-select">이름 선택</label>
        <select id="name-select" class="select" ${filteredNames.length ? "" : "disabled"}>
          <option value="">선택해 주세요</option>
          ${filteredNames.map((name) => `<option value="${escapeHtml(name)}" ${selectedName === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
        </select>
        <div class="muted small">신청 가능 인원 ${availableNames.length}명 / 전체 명단 ${roster.length}명</div>
      </div>
    </section>

    <section class="panel">
      <h2 class="section-title">날짜 선택</h2>
      ${days.length ? `<div class="date-grid">${days.map(renderDateButton).join("")}</div>` : `<p class="notice">신청 가능한 날짜가 없습니다. 관리자 페이지에서 기간과 제외 요일을 확인해 주세요.</p>`}
    </section>

    ${formError ? `<div class="error">${escapeHtml(formError)}</div>` : ""}
    ${formMessage ? `<div class="success">${escapeHtml(formMessage)}</div>` : ""}

    <button id="submit" class="btn" ${saving ? "disabled" : ""}>${saving ? "저장 중..." : "신청하기"}</button>
  `;
}

function renderDateButton(day) {
  const count = entriesFor(day.key).length;
  const cap = getCapacity(settings, day.key);
  const full = count >= cap;
  return `
    <button class="date-card ${selectedDate === day.key ? "on" : ""} ${full ? "full" : ""}" data-date="${day.key}" ${full ? "disabled" : ""}>
      <span>
        <span class="date-main">${escapeHtml(day.label)}</span>
        <span class="date-sub">${count}/${cap}명 신청</span>
      </span>
      <span class="badge ${full ? "full" : ""}">${full ? "마감" : `${cap - count}명 가능`}</span>
    </button>
  `;
}

function renderSchedule() {
  const days = allDays();
  const unregistered = getUnregisteredNames(settings.roster, registrations);
  return `
    <section class="panel">
      <h2 class="section-title">전체 일정표</h2>
      ${days.map((day) => {
        const entries = entriesFor(day.key);
        const cap = getCapacity(settings, day.key);
        const full = entries.length >= cap;
        return `
          <div class="schedule-day">
            <div class="schedule-head">
              <strong>${escapeHtml(day.label)}</strong>
              <span class="badge ${full ? "full" : ""}">${entries.length}/${cap}${full ? " 마감" : ""}</span>
            </div>
            <p class="names ${entries.length ? "" : "empty"}">${entries.length ? entries.map((entry) => escapeHtml(entry.name)).join(", ") : "아직 신청자가 없습니다."}</p>
          </div>
        `;
      }).join("")}
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
      <p class="muted">초기 비밀번호는 0000입니다. 로그인 후 관리자 페이지에서 변경할 수 있습니다.</p>
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
      <div class="row">
        <div class="field">
          <label for="title">제목</label>
          <input id="title" class="input" value="${escapeHtml(settings.title)}">
        </div>
        <div class="field">
          <label for="default-capacity">기본 모집 인원</label>
          <input id="default-capacity" class="input" type="number" min="1" value="${escapeHtml(settings.defaultCapacity)}">
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
      <p class="muted">한 줄에 한 명씩 입력하세요. 신청 화면에는 이 명단의 이름만 표시됩니다.</p>
      <textarea id="roster" class="textarea">${escapeHtml(normalizeRoster(settings.roster).join("\n"))}</textarea>
      <div class="actions">
        <button id="save-roster" class="btn">명단 저장</button>
        <span class="muted">현재 ${normalizeRoster(settings.roster).length}명</span>
      </div>
    </section>

    <section class="panel">
      <h2 class="section-title">날짜별 모집 인원</h2>
      <div class="capacity-list">
        ${days.map((day) => `
          <div class="capacity-row">
            <span>${escapeHtml(day.label)}</span>
            <input class="input capacity" type="number" min="1" data-date="${day.key}" value="${escapeHtml(getCapacity(settings, day.key))}">
          </div>
        `).join("")}
      </div>
      <button id="save-capacities" class="btn">날짜별 인원 저장</button>
    </section>

    <section class="panel">
      <h2 class="section-title">신청자 관리</h2>
      ${days.map((day) => {
        const entries = entriesFor(day.key);
        return `
          <div class="schedule-day">
            <div class="schedule-head">
              <strong>${escapeHtml(day.label)}</strong>
              <span class="badge">${entries.length}/${getCapacity(settings, day.key)}</span>
            </div>
            ${entries.length ? `<div class="unregistered">${entries.map((entry) => `<span class="chip">${escapeHtml(entry.name)} <button data-delete-date="${day.key}" data-delete-id="${entry.id}" title="삭제">x</button></span>`).join("")}</div>` : `<p class="names empty">신청자가 없습니다.</p>`}
          </div>
        `;
      }).join("")}
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
      render();
    });
  });

  const queryEl = document.getElementById("name-query");
  if (queryEl) {
    queryEl.addEventListener("input", (event) => {
      nameQuery = event.target.value;
      render();
    });
  }

  const selectEl = document.getElementById("name-select");
  if (selectEl) {
    selectEl.addEventListener("change", (event) => {
      selectedName = event.target.value;
      formError = "";
    });
  }

  document.querySelectorAll("[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDate = button.dataset.date;
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

  const saveCapacities = document.getElementById("save-capacities");
  if (saveCapacities) saveCapacities.addEventListener("click", handleSaveCapacities);

  document.querySelectorAll("[data-delete-date]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("이 신청을 삭제할까요?")) return;
      await store.deleteEntry(button.dataset.deleteDate, button.dataset.deleteId);
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
  if (!selectedDate) {
    formError = "금식 날짜를 선택해 주세요.";
    render();
    return;
  }

  saving = true;
  render();
  try {
    await store.register(selectedName, selectedDate);
    const day = allDays().find((item) => item.key === selectedDate);
    formMessage = `${selectedName} 님, ${day?.label || selectedDate} 신청이 완료되었습니다.`;
    selectedName = "";
    selectedDate = "";
    nameQuery = "";
  } catch (error) {
    if (error.message === "already") formError = "이미 신청된 이름입니다.";
    else if (error.message === "full") formError = "방금 해당 날짜가 마감되었습니다. 다른 날짜를 선택해 주세요.";
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
    adminPassword: document.getElementById("admin-password").value || "0000",
  });
  await store.saveSettings(next);
}

async function handleSaveRoster() {
  const roster = normalizeRoster(document.getElementById("roster").value);
  await store.saveSettings({ ...settings, roster });
}

async function handleSaveCapacities() {
  const capacities = {};
  document.querySelectorAll(".capacity").forEach((input) => {
    capacities[input.dataset.date] = Math.max(1, Number(input.value) || settings.defaultCapacity);
  });
  await store.saveSettings({ ...settings, capacities });
}

async function init() {
  store = CONFIGURED ? await createFirebaseStore() : await createLocalStore();
  if (store.mode === "local") render();
}

init().catch((error) => {
  appEl.innerHTML = `<div class="panel"><h1>초기화 오류</h1><p class="error">${escapeHtml(error.message)}</p></div>`;
});
