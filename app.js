"use strict";

// Per-group hue rotation from the design handoff.
const GROUP_HUES = [30, 220, 145, 350, 280, 70, 190];

// Base table + seat geometry (in design units). The actual rendered size
// is `unit * scale` where scale is computed to fit the room.
const TABLE_W = 220;
const TABLE_H = 130;
const SEAT_LONG = 80;
const SEAT_SHORT = 34;
const SEAT_GAP = 8;
// The room frame is always a landscape rectangle on screen — the
// "portrait" orientation just rotates the seating *inside* (whiteboard
// moves to the right, tables are tall instead of wide, layout becomes
// columns of tables instead of rows).
const ROOM_ASPECT = 1.6;

// Gaps between tables inside the room, and the room's interior padding.
// In portrait mode the whiteboard sits on the right edge instead of the
// top, so the "padded" side flips.
const ROOM_PAD_FRONT = 36; // top in landscape, right in portrait
const ROOM_PAD_OTHER = 24; // the other three sides
const ROW_GAP = 24;
const COL_GAP = 16;
const GRID_FRONT_MARGIN = 18; // tables-grid clearance from the whiteboard

const state = {
  roster: [],
  absent: new Set(),
  constraintSets: [],     // [{ id, name, hue, members: Set<name> }]
  activeSetId: null,
  groupSize: "4-5",       // value of the active size pill
  orientation: "landscape",
  lastResult: null,       // [{ hue, students: [name, ...] }, ...]
  activeTab: 0,
};
let nextSetId = 1;
let nextHueIndex = 0;

const els = {
  setupBtn: document.getElementById("setup-btn"),
  reshuffleBtn: document.getElementById("reshuffle-btn"),
  addLatecomerBtn: document.getElementById("add-latecomer-btn"),
  fullscreenBtn: document.getElementById("fullscreen-btn"),
  brandMeta: document.getElementById("brand-meta"),

  latecomerDialog: document.getElementById("latecomer-dialog"),
  latecomerList: document.getElementById("latecomer-list"),
  latecomerHint: document.getElementById("latecomer-hint"),
  latecomerEmpty: document.getElementById("latecomer-empty"),
  confirmLatecomerBtn: document.getElementById("confirm-latecomer-btn"),

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
  orientationPills: document.getElementById("orientation-pills"),
  page: document.querySelector(".page"),

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

// --- persistence ---
// Saves roster, constraint sets, group size, and orientation to
// localStorage so the teacher's keep-apart sets survive across
// sessions. Per-day state (attendance, last shuffle) is intentionally
// not persisted.
const STORAGE_KEY = "classGroupMaker.v1";

function persist() {
  try {
    const data = {
      roster: state.roster,
      constraintSets: state.constraintSets.map((cs) => ({
        id: cs.id,
        name: cs.name,
        hue: cs.hue,
        members: [...cs.members],
      })),
      groupSize: state.groupSize,
      orientation: state.orientation,
      nextSetId,
      nextHueIndex,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) {
    // localStorage may be disabled or full — fail silently.
  }
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.roster)) state.roster = data.roster;
    if (Array.isArray(data.constraintSets)) {
      state.constraintSets = data.constraintSets.map((cs) => ({
        id: cs.id,
        name: cs.name || "",
        hue: cs.hue || GROUP_HUES[0],
        members: new Set(Array.isArray(cs.members) ? cs.members : []),
      }));
    }
    if (typeof data.groupSize === "string") state.groupSize = data.groupSize;
    if (data.orientation === "portrait" || data.orientation === "landscape") {
      state.orientation = data.orientation;
    }
    if (typeof data.nextSetId === "number") nextSetId = data.nextSetId;
    if (typeof data.nextHueIndex === "number") nextHueIndex = data.nextHueIndex;
    state.activeSetId = state.constraintSets.length ? state.constraintSets[0].id : null;
  } catch (_) {
    // Corrupted blob — leave state at defaults.
  }
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
      refreshLatecomerButton();
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
  refreshLatecomerButton();
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
  persist();
}
function deleteSet(id) {
  state.constraintSets = state.constraintSets.filter((s) => s.id !== id);
  if (state.activeSetId === id) {
    state.activeSetId = state.constraintSets.length ? state.constraintSets[0].id : null;
  }
  renderSetList();
  renderEditor();
  refreshStepMeta();
  persist();
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
    persist();
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
      persist();
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
  persist();
});

function renderOrientationPills() {
  Array.from(els.orientationPills.querySelectorAll(".size-pill")).forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.value === state.orientation);
  });
}
els.orientationPills.addEventListener("click", (e) => {
  const pill = e.target.closest(".size-pill");
  if (!pill) return;
  state.orientation = pill.dataset.value;
  renderOrientationPills();
  // Re-fit the room and re-render in the new orientation. renderClassroom
  // handles the empty state and updates the grid's orientation class.
  fitRoom();
  renderClassroom(state.lastResult);
  persist();
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
// Tables always use the landscape footprint (304 wide x 214 tall) — the
// "portrait" orientation only flips where the board sits and how the
// tables are arranged in the room, not the table itself.
const TABLE_FOOTPRINT_W = TABLE_W + (SEAT_SHORT + SEAT_GAP) * 2;
const TABLE_FOOTPRINT_H = TABLE_H + (SEAT_SHORT + SEAT_GAP) * 2;

function seatLayout(n) {
  if (n <= 0) return [];
  // 2 chairs on each long side (top/bottom), 1 on each short side.
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

// Decide cols/rows for the layout. Target the room's aspect ratio so
// the grid uses available space without spreading into too many sparse
// columns.
function computeGridLayout(numGroups, orientation) {
  if (numGroups <= 0) return { cols: 0, rows: 0, distribution: [] };
  const target = ROOM_ASPECT;
  let bestCols = numGroups;
  let bestRows = 1;
  let bestScore = Infinity;
  for (let cols = 1; cols <= numGroups; cols++) {
    const rows = Math.ceil(numGroups / cols);
    const aspect = cols / rows;
    const score = Math.abs(Math.log(aspect / target));
    if (score < bestScore) {
      bestScore = score;
      bestCols = cols;
      bestRows = rows;
    }
  }
  if (orientation === "portrait") {
    // Distribution is per-COLUMN, left-to-right. The leftmost columns
    // are the back of the class (board is on the right), so extras
    // land there.
    const baseCount = Math.floor(numGroups / bestCols);
    const extras = numGroups % bestCols;
    const distribution = [];
    for (let i = 0; i < bestCols; i++) {
      distribution.push(i < extras ? baseCount + 1 : baseCount);
    }
    return { cols: bestCols, rows: bestRows, distribution };
  }
  // Landscape: per-ROW distribution, top-to-bottom. Extras go to the
  // last (back) rows.
  const baseCount = Math.floor(numGroups / bestRows);
  const extras = numGroups % bestRows;
  const distribution = [];
  for (let i = 0; i < bestRows; i++) {
    distribution.push(i < bestRows - extras ? baseCount : baseCount + 1);
  }
  return { cols: bestCols, rows: bestRows, distribution };
}

// Resize the room frame to fit the available page area at the
// landscape aspect (the room is always landscape on screen).
function fitRoom() {
  const pageBox = els.page.getBoundingClientRect();
  const availW = Math.max(200, pageBox.width);
  const availH = Math.max(200, pageBox.height);
  let w, h;
  if (availW / availH > ROOM_ASPECT) {
    h = availH;
    w = h * ROOM_ASPECT;
  } else {
    w = availW;
    h = w / ROOM_ASPECT;
  }
  els.classroom.style.width = `${Math.floor(w)}px`;
  els.classroom.style.height = `${Math.floor(h)}px`;
  // Set the orientation class on the room so the whiteboard, padding,
  // and tables-grid layout switch to the right side / direction.
  els.classroom.classList.toggle("portrait", state.orientation === "portrait");
  els.classroom.classList.toggle("landscape", state.orientation !== "portrait");
}

function renderTable(group, idx, scale) {
  const tableW = TABLE_W * scale;
  const tableH = TABLE_H * scale;
  const seatLong = SEAT_LONG * scale;
  const seatShort = SEAT_SHORT * scale;
  const seatGap = SEAT_GAP * scale;
  const totalW = tableW + (seatShort + seatGap) * 2;
  const totalH = tableH + (seatShort + seatGap) * 2;

  const wrap = document.createElement("div");
  wrap.className = "td-table";
  wrap.style.width = `${totalW}px`;
  wrap.style.height = `${totalH}px`;
  wrap.style.setProperty("--td-tint", `oklch(0.94 0.05 ${group.hue})`);
  wrap.style.setProperty("--td-edge", `oklch(0.78 0.09 ${group.hue})`);
  wrap.style.setProperty("--td-ink", `oklch(0.3 0.06 ${group.hue})`);
  wrap.style.setProperty("--td-seat", `oklch(0.97 0.02 ${group.hue})`);

  const surface = document.createElement("div");
  surface.className = "td-table-surface";
  surface.style.left = `${seatShort + seatGap}px`;
  surface.style.top = `${seatShort + seatGap}px`;
  surface.style.width = `${tableW}px`;
  surface.style.height = `${tableH}px`;

  const title = document.createElement("div");
  title.className = "td-table-title";
  title.textContent = `Group ${idx + 1}`;
  // Title font scales with the table's shorter dimension so it stays
  // proportional whether the table is wide-landscape or tall-portrait.
  const titleFontPx = Math.max(10, Math.min(16, Math.min(tableW, tableH) * 0.10));
  title.style.fontSize = `${titleFontPx}px`;

  surface.appendChild(title);

  // If a group has more than 6 students (latecomers can push it over),
  // render the extra names as a small overflow line inside the table.
  if (group.students.length > 6) {
    const overflow = document.createElement("div");
    overflow.className = "td-table-overflow";
    overflow.textContent = `+ ${group.students.slice(6).join(", ")}`;
    overflow.style.fontSize = `${Math.max(8, Math.min(12, Math.min(tableW, tableH) * 0.07))}px`;
    surface.appendChild(overflow);
  }

  wrap.appendChild(surface);

  const layout = seatLayout(group.students.length);
  // Seat label font scales with the seat's short dimension.
  const seatFontPx = Math.max(9, Math.min(15, seatShort * 0.42));
  layout.forEach((s, i) => {
    const seat = document.createElement("div");
    seat.className = "td-seat";
    if (s.side === "left" || s.side === "right") {
      seat.classList.add("vertical", s.side);
      seat.style.width = `${seatShort}px`;
      seat.style.height = `${seatLong}px`;
      seat.style.top = `${(seatShort + seatGap) + s.t * tableH - seatLong / 2}px`;
      seat.style.left = s.side === "left" ? "0" : `${totalW - seatShort}px`;
    } else {
      seat.style.width = `${seatLong}px`;
      seat.style.height = `${seatShort}px`;
      seat.style.left = `${(seatShort + seatGap) + s.t * tableW - seatLong / 2}px`;
      seat.style.top = s.side === "top" ? "0" : `${totalH - seatShort}px`;
    }
    const label = document.createElement("span");
    label.textContent = group.students[i] || "";
    label.style.fontSize = `${seatFontPx}px`;
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
  els.groupsGrid.classList.toggle("portrait", state.orientation === "portrait");
  els.groupsGrid.classList.toggle("landscape", state.orientation !== "portrait");
  if (!groups || groups.length === 0) {
    showEmptyHint();
    return;
  }

  // Make sure the room frame is sized before we measure it.
  fitRoom();

  const isPortrait = state.orientation === "portrait";
  const layout = computeGridLayout(groups.length, state.orientation);
  const roomBox = els.classroom.getBoundingClientRect();

  // Inner area = room minus the per-orientation padding minus the
  // grid's clearance from the board.
  const innerW = roomBox.width
    - (isPortrait ? ROOM_PAD_OTHER + ROOM_PAD_FRONT : ROOM_PAD_OTHER * 2)
    - (isPortrait ? GRID_FRONT_MARGIN : 0);
  const innerH = roomBox.height
    - (isPortrait ? ROOM_PAD_OTHER * 2 : ROOM_PAD_FRONT + ROOM_PAD_OTHER)
    - (isPortrait ? 0 : GRID_FRONT_MARGIN);

  // Size cells against the widest/tallest *actual* group of tables —
  // gridDims may pick more cols than any single row uses.
  const maxItems = Math.max(...layout.distribution);
  let cellW, cellH;
  if (isPortrait) {
    // distribution is per-column. cols horizontally, max items per col vertically.
    cellW = (innerW - (layout.cols - 1) * COL_GAP) / layout.cols;
    cellH = (innerH - (maxItems - 1) * ROW_GAP) / maxItems;
  } else {
    cellW = (innerW - (maxItems - 1) * COL_GAP) / maxItems;
    cellH = (innerH - (layout.rows - 1) * ROW_GAP) / layout.rows;
  }
  const scale = Math.max(0.35, Math.min(cellW / TABLE_FOOTPRINT_W, cellH / TABLE_FOOTPRINT_H, 1.4));

  let groupIdx = 0;
  if (isPortrait) {
    // Render columns left-to-right; each column is a vertical stack of
    // tables. Leftmost columns are the "back" of the class.
    layout.distribution.forEach((count) => {
      const col = document.createElement("div");
      col.className = "tables-col";
      for (let i = 0; i < count; i++) {
        col.appendChild(renderTable(groups[groupIdx], groupIdx, scale));
        groupIdx++;
      }
      els.groupsGrid.appendChild(col);
    });
  } else {
    layout.distribution.forEach((count) => {
      const row = document.createElement("div");
      row.className = "tables-row";
      for (let i = 0; i < count; i++) {
        row.appendChild(renderTable(groups[groupIdx], groupIdx, scale));
        groupIdx++;
      }
      els.groupsGrid.appendChild(row);
    });
  }
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
  refreshLatecomerButton();
  return true;
}

function reshuffle() { makeGroups(); }

// --- latecomers ---
// Drop a list of newly-arrived students into existing groups, putting
// each into the smallest group with the fewest constraint conflicts.
// Tied sizes prefer groups whose members don't share a constraint set
// with the latecomer.
function placeLatecomers(latecomers) {
  if (!state.lastResult || latecomers.length === 0) return state.lastResult;
  const groups = state.lastResult.map((g) => ({ ...g, students: [...g.students] }));

  const studentSets = new Map();
  state.constraintSets.forEach((cs, idx) => {
    cs.members.forEach((m) => {
      if (!studentSets.has(m)) studentSets.set(m, []);
      studentSets.get(m).push(idx);
    });
  });
  const conflictsWith = (group, candidate) => {
    const candSets = studentSets.get(candidate);
    if (!candSets) return 0;
    let c = 0;
    for (const m of group.students) {
      const mSets = studentSets.get(m);
      if (!mSets) continue;
      for (const cs of candSets) if (mSets.includes(cs)) c++;
    }
    return c;
  };

  for (const latecomer of latecomers) {
    const minSize = Math.min(...groups.map((g) => g.students.length));
    let bestIdx = -1;
    let bestConflicts = Infinity;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].students.length !== minSize) continue;
      const c = conflictsWith(groups[i], latecomer);
      if (c < bestConflicts) {
        bestIdx = i;
        bestConflicts = c;
      }
    }
    if (bestIdx === -1) bestIdx = 0;
    groups[bestIdx].students.push(latecomer);
  }
  return groups;
}

function refreshLatecomerButton() {
  const hasGroups = !!(state.lastResult && state.lastResult.length > 0);
  const hasAbsent = state.absent.size > 0;
  els.addLatecomerBtn.disabled = !(hasGroups && hasAbsent);
}

let selectedLatecomers = new Set();

function renderLatecomerList() {
  els.latecomerList.innerHTML = "";
  const absent = [...state.absent].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  if (absent.length === 0) {
    els.latecomerEmpty.hidden = false;
    els.latecomerHint.hidden = true;
    els.confirmLatecomerBtn.disabled = true;
    return;
  }
  els.latecomerEmpty.hidden = true;
  els.latecomerHint.hidden = false;

  absent.forEach((name) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "att-chip absent";

    const mark = document.createElement("span");
    mark.className = "att-mark";

    const label = document.createElement("span");
    label.className = "att-name";
    label.textContent = name;

    btn.appendChild(mark);
    btn.appendChild(label);
    btn.addEventListener("click", () => {
      if (selectedLatecomers.has(name)) {
        selectedLatecomers.delete(name);
        btn.classList.add("absent");
        mark.textContent = "";
      } else {
        selectedLatecomers.add(name);
        btn.classList.remove("absent");
        mark.textContent = "✓";
      }
      els.confirmLatecomerBtn.disabled = selectedLatecomers.size === 0;
    });
    els.latecomerList.appendChild(btn);
  });
  els.confirmLatecomerBtn.disabled = true;
}

function openLatecomerDialog() {
  selectedLatecomers = new Set();
  renderLatecomerList();
  els.latecomerDialog.showModal();
}

function confirmLatecomers() {
  const names = [...selectedLatecomers];
  if (names.length === 0) return;
  state.lastResult = placeLatecomers(names);
  names.forEach((n) => state.absent.delete(n));
  renderClassroom(state.lastResult);
  refreshBrandMeta();
  refreshLatecomerButton();
  els.latecomerDialog.close();
}

function openSetup() { els.setupDialog.showModal(); }
function closeSetup() { els.setupDialog.close(); }

// --- wire up ---
els.setupBtn.addEventListener("click", openSetup);
els.reshuffleBtn.addEventListener("click", reshuffle);
els.addLatecomerBtn.addEventListener("click", openLatecomerDialog);
els.confirmLatecomerBtn.addEventListener("click", confirmLatecomers);
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
  persist();
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
  refreshLatecomerButton();
  persist();
  setActiveTab(0);
});

els.allPresentBtn.addEventListener("click", () => setAllAttendance(true));
els.allAbsentBtn.addEventListener("click", () => setAllAttendance(false));

els.addSetBtn.addEventListener("click", addConstraintSet);

els.makeGroupsBtn.addEventListener("click", () => {
  if (makeGroups()) closeSetup();
});

// Re-fit the room and re-render the layout whenever the available
// space changes — window resize, fullscreen transitions, etc. A
// ResizeObserver on the page element catches them all reliably; the
// rAF debounce avoids thrashing during continuous resizes.
let refitRaf = 0;
function scheduleRefit() {
  if (refitRaf) cancelAnimationFrame(refitRaf);
  refitRaf = requestAnimationFrame(() => {
    fitRoom();
    if (state.lastResult) renderClassroom(state.lastResult);
  });
}
const pageResizeObserver = new ResizeObserver(scheduleRefit);
pageResizeObserver.observe(els.page);
window.addEventListener("resize", scheduleRefit);
document.addEventListener("fullscreenchange", scheduleRefit);

// Restore saved roster, constraint sets, group size, and orientation
// before the first paint so the UI reflects them immediately.
loadPersisted();
if (state.roster.length > 0) {
  els.rosterInput.value = state.roster.join("\n");
}

// Initial paint
setActiveTab(0);
renderSizePills();
renderOrientationPills();
refreshStepMeta();
refreshBrandMeta();
refreshLatecomerButton();
renderAttendance();
renderSetList();
renderEditor();
fitRoom();
// Renders the empty hint and tags the grid with the orientation class.
renderClassroom(null);

// Auto-open setup on first load
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", openSetup);
} else {
  openSetup();
}
