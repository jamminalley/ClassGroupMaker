"use strict";

// Per-group hue rotation from the design handoff.
const GROUP_HUES = [30, 220, 145, 350, 280, 70, 190];

// Table + seat geometry. The wrapper is sized to leave room for chair
// tiles on every side.
const TABLE_W = 220;
const TABLE_H = 130;
const SEAT_LONG = 80;
const SEAT_SHORT = 34;
const SEAT_GAP = 8;
const TOTAL_W = TABLE_W + (SEAT_SHORT + SEAT_GAP) * 2;
const TOTAL_H = TABLE_H + (SEAT_SHORT + SEAT_GAP) * 2;

const state = {
  roster: [],
  absent: new Set(),
  constraintSets: [],     // [{ id, name, hue, members: Set<name> }]
  activeSetId: null,
  groupSize: "4-5",       // value of the active size pill
  lastResult: null,       // [{ hue, students: [name, ...] }, ...]
  activeTab: 0,
};
let nextSetId = 1;
let nextHueIndex = 0;

const els = {
  setupBtn: document.getElementById("setup-btn"),
  reshuffleBtn: document.getElementById("reshuffle-btn"),
  fullscreenBtn: document.getElementById("fullscreen-btn"),
  brandMeta: document.getElementById("brand-meta"),

  classroom: document.getElementById("classroom"),
  groupsGrid: document.getElementById("groups-grid"),

  setupDialog: document.getElementById("setup-dialog"),

  rosterInput: document.getElementById("roster-input"),
  loadRosterBtn: document.getElementById("load-roster-btn"),
  clearRosterBtn: document.getElementById("clear-roster-btn"),

  attendanceList: document.getElementById("attendance-list"),
  attendanceHint: document.getElementById("attendance-hint"),
  attendanceEmpty: document.getElementById("attendance-empty"),
  allPresentBtn: document.getElementById("all-present-btn"),
  allAbsentBtn: document.getElementById("all-absent-btn"),

  setList: document.getElementById("set-list"),
  addSetBtn: document.getElementById("add-set-btn"),
  constraintsEditor: document.getElementById("constraints-editor"),
  sizePills: document.getElementById("size-pills"),

  groupingError: document.getElementById("grouping-error"),
  makeGroupsBtn: document.getElementById("make-groups-btn"),
};

const stepMetas = [0, 1, 2].map((i) => document.getElementById(`step-meta-${i}`));
const stepTabs = Array.from(document.querySelectorAll(".step-tab"));
const stepBodies = Array.from(document.querySelectorAll(".step-body"));

// --- helpers ---
function parseRoster(text) {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sortedRoster() {
  return state.roster.slice().sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}
function getPresent() {
  return state.roster.filter((n) => !state.absent.has(n));
}
function activeSet() {
  return state.constraintSets.find((s) => s.id === state.activeSetId) || null;
}

// --- step rail ---
function setActiveTab(idx) {
  state.activeTab = idx;
  stepTabs.forEach((t, i) => {
    t.classList.toggle("active", i === idx);
    t.setAttribute("aria-selected", i === idx ? "true" : "false");
  });
  stepBodies.forEach((b, i) => (b.hidden = i !== idx));
}

function refreshStepMeta() {
  stepMetas[0].textContent = `${state.roster.length} students`;
  if (state.roster.length === 0) {
    stepMetas[1].textContent = "—";
  } else {
    const present = getPresent().length;
    stepMetas[1].textContent = `${present} present, ${state.absent.size} out`;
  }
  stepMetas[2].textContent = `${state.constraintSets.length} ${state.constraintSets.length === 1 ? "set" : "sets"}`;
}

function refreshBrandMeta() {
  if (state.roster.length === 0) {
    els.brandMeta.textContent = "No roster loaded";
  } else {
    const present = getPresent().length;
    els.brandMeta.textContent = `${present} / ${state.roster.length} present`;
  }
}

// --- attendance ---
function renderAttendance() {
  els.attendanceList.innerHTML = "";
  if (state.roster.length === 0) {
    els.attendanceEmpty.hidden = false;
    els.attendanceHint.hidden = true;
    return;
  }
  els.attendanceEmpty.hidden = true;
  els.attendanceHint.hidden = false;
  els.attendanceHint.textContent = `Tap a name to toggle absent.`;

  sortedRoster().forEach((name) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "att-chip";
    if (state.absent.has(name)) btn.classList.add("absent");

    const mark = document.createElement("span");
    mark.className = "att-mark";
    mark.textContent = state.absent.has(name) ? "" : "✓";

    const label = document.createElement("span");
    label.className = "att-name";
    label.textContent = name;

    btn.appendChild(mark);
    btn.appendChild(label);
    btn.addEventListener("click", () => {
      if (state.absent.has(name)) state.absent.delete(name);
      else state.absent.add(name);
      btn.classList.toggle("absent");
      mark.textContent = state.absent.has(name) ? "" : "✓";
      refreshStepMeta();
      refreshBrandMeta();
    });
    els.attendanceList.appendChild(btn);
  });
}

function setAllAttendance(present) {
  if (present) state.absent.clear();
  else state.roster.forEach((n) => state.absent.add(n));
  renderAttendance();
  refreshStepMeta();
  refreshBrandMeta();
}

// --- constraint sets ---
function nextHue() {
  const h = GROUP_HUES[nextHueIndex % GROUP_HUES.length];
  nextHueIndex++;
  return h;
}
function addConstraintSet() {
  const set = {
    id: nextSetId++,
    name: `Set ${state.constraintSets.length + 1}`,
    hue: nextHue(),
    members: new Set(),
  };
  state.constraintSets.push(set);
  state.activeSetId = set.id;
  renderSetList();
  renderEditor();
  refreshStepMeta();
}
function deleteSet(id) {
  state.constraintSets = state.constraintSets.filter((s) => s.id !== id);
  if (state.activeSetId === id) {
    state.activeSetId = state.constraintSets.length ? state.constraintSets[0].id : null;
  }
  renderSetList();
  renderEditor();
  refreshStepMeta();
}

function renderSetList() {
  els.setList.innerHTML = "";
  state.constraintSets.forEach((s) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "set-row";
    if (s.id === state.activeSetId) row.classList.add("active");
    row.style.setProperty("--set-hue", s.hue);

    const swatch = document.createElement("span");
    swatch.className = "set-swatch";

    const info = document.createElement("div");
    info.className = "set-row-info";

    const name = document.createElement("div");
    name.className = "set-row-name";
    name.textContent = s.name || "Untitled set";

    const meta = document.createElement("div");
    meta.className = "set-row-meta";
    const count = [...s.members].filter((m) => state.roster.includes(m)).length;
    meta.textContent = `${count} ${count === 1 ? "member" : "members"}`;

    info.appendChild(name);
    info.appendChild(meta);
    row.appendChild(swatch);
    row.appendChild(info);

    row.addEventListener("click", () => {
      state.activeSetId = s.id;
      renderSetList();
      renderEditor();
    });

    els.setList.appendChild(row);
  });
}

function renderEditor() {
  els.constraintsEditor.innerHTML = "";

  if (state.roster.length === 0) {
    const empty = document.createElement("div");
    empty.className = "editor-empty";
    empty.textContent = "Load a roster first, then add a keep-apart set.";
    els.constraintsEditor.appendChild(empty);
    return;
  }
  if (state.constraintSets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "editor-empty";
    empty.innerHTML = `Add a set to start. Use one big set (e.g. <em>Strong students</em>) to spread experts across groups, or a small set to keep table-mates apart.`;
    els.constraintsEditor.appendChild(empty);
    return;
  }

  const cur = activeSet();
  if (!cur) return;

  const editor = document.createElement("div");
  editor.style.setProperty("--set-hue", cur.hue);

  const header = document.createElement("div");
  header.className = "editor-header";

  const left = document.createElement("div");
  left.className = "editor-header-left";

  const swatch = document.createElement("span");
  swatch.className = "editor-swatch";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "editor-name";
  nameInput.value = cur.name;
  nameInput.placeholder = "Name this set";
  nameInput.addEventListener("input", () => {
    cur.name = nameInput.value;
    renderSetList();
  });

  left.appendChild(swatch);
  left.appendChild(nameInput);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn-ghost btn-pill editor-delete";
  delBtn.textContent = "Delete set";
  delBtn.addEventListener("click", () => deleteSet(cur.id));

  header.appendChild(left);
  header.appendChild(delBtn);
  editor.appendChild(header);

  const hint = document.createElement("p");
  hint.className = "ui-hint";
  hint.textContent = "Click names to add or remove from this set.";
  editor.appendChild(hint);

  const grid = document.createElement("div");
  grid.className = "member-grid";
  sortedRoster().forEach((name) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "member-chip";
    if (cur.members.has(name)) chip.classList.add("in-set");
    if (state.absent.has(name)) chip.classList.add("absent");
    chip.textContent = name;
    chip.addEventListener("click", () => {
      if (cur.members.has(name)) cur.members.delete(name);
      else cur.members.add(name);
      chip.classList.toggle("in-set");
      renderSetList();
      renderSummary();
    });
    grid.appendChild(chip);
  });
  editor.appendChild(grid);

  const summary = document.createElement("div");
  summary.id = "summary-panel-host";
  editor.appendChild(summary);

  els.constraintsEditor.appendChild(editor);
  renderSummary();
}

function renderSummary() {
  const host = document.getElementById("summary-panel-host");
  if (!host) return;
  host.innerHTML = "";

  const tags = state.constraintSets.flatMap((s) =>
    [...s.members]
      .filter((m) => state.roster.includes(m))
      .map((m) => ({ name: m, hue: s.hue }))
  );
  if (tags.length === 0) return;

  const panel = document.createElement("div");
  panel.className = "summary-panel";

  const label = document.createElement("div");
  label.className = "summary-panel-label";
  label.textContent = "Students in any keep-apart set";

  const wrap = document.createElement("div");
  wrap.className = "summary-tags";
  tags
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .forEach((t) => {
      const tag = document.createElement("span");
      tag.className = "summary-tag";
      tag.style.setProperty("--tag-hue", t.hue);
      const dot = document.createElement("span");
      dot.className = "summary-tag-dot";
      tag.appendChild(dot);
      tag.appendChild(document.createTextNode(t.name));
      wrap.appendChild(tag);
    });

  panel.appendChild(label);
  panel.appendChild(wrap);
  host.appendChild(panel);
}

// --- group size pills ---
function renderSizePills() {
  Array.from(els.sizePills.querySelectorAll(".size-pill")).forEach((pill) => {
    const isActive = pill.dataset.value === state.groupSize;
    pill.classList.toggle("active", isActive);
  });
}
els.sizePills.addEventListener("click", (e) => {
  const pill = e.target.closest(".size-pill");
  if (!pill) return;
  state.groupSize = pill.dataset.value;
  renderSizePills();
});

// --- partition + assignment ---
function partitionSizes(n, min, max) {
  if (n <= 0 || min > max || n < min) return null;
  const kMin = Math.ceil(n / max);
  const kMax = Math.floor(n / min);
  if (kMin > kMax) return null;
  let bestK = kMin;
  let bestSpread = Infinity;
  for (let k = kMin; k <= kMax; k++) {
    const spread = n % k === 0 ? 0 : 1;
    if (spread < bestSpread) {
      bestSpread = spread;
      bestK = k;
    }
  }
  const k = bestK;
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => (i < extra ? base + 1 : base));
}

function assignWithConstraints(students, sizes, constraintSets) {
  const groups = sizes.map(() => []);
  const remaining = sizes.slice();

  const activeSets = constraintSets
    .map((cs) => [...cs.members].filter((m) => students.includes(m)))
    .filter((m) => m.length >= 2);

  const studentSets = new Map();
  activeSets.forEach((members, idx) => {
    members.forEach((m) => {
      if (!studentSets.has(m)) studentSets.set(m, []);
      studentSets.get(m).push(idx);
    });
  });

  function conflicts(groupIdx, candidate) {
    const candSets = studentSets.get(candidate);
    if (!candSets) return 0;
    let c = 0;
    for (const m of groups[groupIdx]) {
      const mSets = studentSets.get(m);
      if (!mSets) continue;
      for (const cs of candSets) if (mSets.includes(cs)) c++;
    }
    return c;
  }
  function pickGroup(candidate) {
    let best = -1;
    let bestConflicts = Infinity;
    let bestRemaining = -1;
    for (let i = 0; i < groups.length; i++) {
      if (remaining[i] === 0) continue;
      const c = conflicts(i, candidate);
      if (c < bestConflicts || (c === bestConflicts && remaining[i] > bestRemaining)) {
        best = i;
        bestConflicts = c;
        bestRemaining = remaining[i];
      }
    }
    return best;
  }

  const placed = new Set();
  const orderedSets = activeSets
    .map((members) => members)
    .sort((a, b) => b.length - a.length);

  for (const members of orderedSets) {
    for (const member of shuffle(members)) {
      if (placed.has(member)) continue;
      const g = pickGroup(member);
      if (g === -1) continue;
      groups[g].push(member);
      remaining[g]--;
      placed.add(member);
    }
  }

  const others = shuffle(students.filter((s) => !placed.has(s)));
  for (const s of others) {
    const g = pickGroup(s);
    if (g === -1) continue;
    groups[g].push(s);
    remaining[g]--;
  }

  return groups.map((g) => shuffle(g));
}

// --- top-down classroom rendering ---
function seatLayout(n) {
  if (n <= 0) return [];
  const caps = { top: 2, bottom: 2, left: 1, right: 1 };
  const order = ["top", "bottom", "left", "right"];
  const counts = { top: 0, bottom: 0, left: 0, right: 0 };
  let remaining = Math.min(n, 6);
  for (const side of order) {
    const take = Math.min(caps[side], remaining);
    counts[side] = take;
    remaining -= take;
    if (!remaining) break;
  }
  const seats = [];
  for (const side of order) {
    const c = counts[side];
    for (let k = 0; k < c; k++) {
      const t = c === 1 ? 0.5 : (k + 1) / (c + 1);
      seats.push({ side, t });
    }
  }
  return seats;
}

function renderTable(group, idx) {
  const wrap = document.createElement("div");
  wrap.className = "td-table";
  wrap.style.width = `${TOTAL_W}px`;
  wrap.style.height = `${TOTAL_H}px`;
  wrap.style.setProperty("--td-tint", `oklch(0.94 0.05 ${group.hue})`);
  wrap.style.setProperty("--td-edge", `oklch(0.78 0.09 ${group.hue})`);
  wrap.style.setProperty("--td-ink", `oklch(0.3 0.06 ${group.hue})`);
  wrap.style.setProperty("--td-seat", `oklch(0.97 0.02 ${group.hue})`);

  const surface = document.createElement("div");
  surface.className = "td-table-surface";
  surface.style.left = `${SEAT_SHORT + SEAT_GAP}px`;
  surface.style.top = `${SEAT_SHORT + SEAT_GAP}px`;
  surface.style.width = `${TABLE_W}px`;
  surface.style.height = `${TABLE_H}px`;

  const title = document.createElement("div");
  title.className = "td-table-title";
  title.textContent = `Group ${idx + 1}`;

  const meta = document.createElement("div");
  meta.className = "td-table-meta";
  meta.textContent = `${String(idx + 1).padStart(2, "0")} · ${group.students.length} ${group.students.length === 1 ? "seat" : "seats"}`;

  surface.appendChild(title);
  surface.appendChild(meta);
  wrap.appendChild(surface);

  const layout = seatLayout(group.students.length);
  layout.forEach((s, i) => {
    const seat = document.createElement("div");
    seat.className = "td-seat";
    if (s.side === "left" || s.side === "right") {
      seat.classList.add("vertical", s.side);
      seat.style.width = `${SEAT_SHORT}px`;
      seat.style.height = `${SEAT_LONG}px`;
      seat.style.top = `${(SEAT_SHORT + SEAT_GAP) + s.t * TABLE_H - SEAT_LONG / 2}px`;
      seat.style.left = s.side === "left" ? "0" : `${TOTAL_W - SEAT_SHORT}px`;
    } else {
      seat.style.width = `${SEAT_LONG}px`;
      seat.style.height = `${SEAT_SHORT}px`;
      seat.style.left = `${(SEAT_SHORT + SEAT_GAP) + s.t * TABLE_W - SEAT_LONG / 2}px`;
      seat.style.top = s.side === "top" ? "0" : `${TOTAL_H - SEAT_SHORT}px`;
    }
    const label = document.createElement("span");
    label.textContent = group.students[i] || "";
    seat.appendChild(label);
    wrap.appendChild(seat);
  });

  return wrap;
}

function showEmptyHint() {
  els.groupsGrid.innerHTML = "";
  const hint = document.createElement("div");
  hint.className = "empty-hint";
  hint.innerHTML = "<p>No groups yet.</p><p>Click <strong>Setup</strong> to load a roster and make groups.</p>";
  els.groupsGrid.appendChild(hint);
}

function renderClassroom(groups) {
  els.groupsGrid.innerHTML = "";
  if (!groups || groups.length === 0) {
    showEmptyHint();
    return;
  }
  groups.forEach((g, i) => {
    els.groupsGrid.appendChild(renderTable(g, i));
  });
}

// --- main actions ---
function getSelectedSizeRange() {
  const [a, b] = state.groupSize.split("-");
  return { min: Number(a), max: Number(b) };
}

function makeGroups() {
  els.groupingError.hidden = true;
  const present = getPresent();
  const { min, max } = getSelectedSizeRange();
  const sizes = partitionSizes(present.length, min, max);
  if (!sizes) {
    const range = min === max ? `${min}` : `${min}–${max}`;
    els.groupingError.textContent = `Can't make groups of ${range} from ${present.length} present students.`;
    els.groupingError.hidden = false;
    return false;
  }
  const studentGroups = assignWithConstraints(present, sizes, state.constraintSets);
  // Attach a hue to each group from the rotating palette.
  const groups = studentGroups.map((students, i) => ({
    hue: GROUP_HUES[i % GROUP_HUES.length],
    students,
  }));
  state.lastResult = groups;
  renderClassroom(groups);
  els.reshuffleBtn.disabled = false;
  return true;
}

function reshuffle() { makeGroups(); }

function openSetup() { els.setupDialog.showModal(); }
function closeSetup() { els.setupDialog.close(); }

// --- wire up ---
els.setupBtn.addEventListener("click", openSetup);
els.reshuffleBtn.addEventListener("click", reshuffle);
els.fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});

stepTabs.forEach((t) => {
  t.addEventListener("click", () => setActiveTab(Number(t.dataset.tab)));
});

els.loadRosterBtn.addEventListener("click", () => {
  const names = parseRoster(els.rosterInput.value);
  if (names.length === 0) return;
  state.roster = names;
  state.absent = new Set([...state.absent].filter((n) => state.roster.includes(n)));
  state.constraintSets.forEach((cs) => {
    cs.members = new Set([...cs.members].filter((n) => state.roster.includes(n)));
  });
  renderAttendance();
  renderSetList();
  renderEditor();
  refreshStepMeta();
  refreshBrandMeta();
  // Move the user forward to attendance so the new roster is visible.
  setActiveTab(1);
});

els.clearRosterBtn.addEventListener("click", () => {
  els.rosterInput.value = "";
  state.roster = [];
  state.absent.clear();
  state.constraintSets = [];
  state.activeSetId = null;
  nextHueIndex = 0;
  renderAttendance();
  renderSetList();
  renderEditor();
  refreshStepMeta();
  refreshBrandMeta();
  setActiveTab(0);
});

els.allPresentBtn.addEventListener("click", () => setAllAttendance(true));
els.allAbsentBtn.addEventListener("click", () => setAllAttendance(false));

els.addSetBtn.addEventListener("click", addConstraintSet);

els.makeGroupsBtn.addEventListener("click", () => {
  if (makeGroups()) closeSetup();
});

// Initial paint
setActiveTab(0);
renderSizePills();
refreshStepMeta();
refreshBrandMeta();
renderAttendance();
renderSetList();
renderEditor();

// Auto-open setup on first load
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", openSetup);
} else {
  openSetup();
}
