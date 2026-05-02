"use strict";

const ROOM_ASPECT = 1.5;

const state = {
  roster: [],          // [name, ...]
  absent: new Set(),   // names marked absent
  constraintSets: [],  // [{ id, name, members: Set<name> }]
  lastResult: null,    // last rendered groups [[name, ...], ...]
};
let nextConstraintId = 1;

const els = {
  setupBtn: document.getElementById("setup-btn"),
  reshuffleBtn: document.getElementById("reshuffle-btn"),
  fullscreenBtn: document.getElementById("fullscreen-btn"),

  classroom: document.getElementById("classroom"),
  groupsGrid: document.getElementById("groups-grid"),

  setupDialog: document.getElementById("setup-dialog"),
  closeSetupBtn: document.getElementById("close-setup-btn"),
  closeSetupFooterBtn: document.getElementById("close-setup-footer-btn"),

  rosterInput: document.getElementById("roster-input"),
  loadRosterBtn: document.getElementById("load-roster-btn"),
  clearRosterBtn: document.getElementById("clear-roster-btn"),

  attendancePanel: document.getElementById("attendance-panel"),
  attendanceList: document.getElementById("attendance-list"),
  attendanceCount: document.getElementById("attendance-count"),
  allPresentBtn: document.getElementById("all-present-btn"),
  allAbsentBtn: document.getElementById("all-absent-btn"),

  constraintsPanel: document.getElementById("constraints-panel"),
  constraintSets: document.getElementById("constraint-sets"),
  addConstraintBtn: document.getElementById("add-constraint-btn"),

  groupingPanel: document.getElementById("grouping-panel"),
  groupingError: document.getElementById("grouping-error"),
  makeGroupsBtn: document.getElementById("make-groups-btn"),
};

// --- helpers ---
function parseRoster(text) {
  return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function sortedRoster() {
  return state.roster.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- attendance ---
function renderAttendance() {
  els.attendanceList.innerHTML = "";
  sortedRoster().forEach((name, i) => {
    const id = `student-${i}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    if (state.absent.has(name)) label.classList.add("absent");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.checked = !state.absent.has(name);
    cb.addEventListener("change", () => {
      if (cb.checked) state.absent.delete(name);
      else state.absent.add(name);
      label.classList.toggle("absent", !cb.checked);
      updateAttendanceCount();
    });

    const span = document.createElement("span");
    span.textContent = name;

    label.appendChild(cb);
    label.appendChild(span);
    els.attendanceList.appendChild(label);
  });
  updateAttendanceCount();
}

function getPresent() {
  return state.roster.filter((n) => !state.absent.has(n));
}

function updateAttendanceCount() {
  els.attendanceCount.textContent = `${getPresent().length} of ${state.roster.length} present`;
}

function setAllAttendance(present) {
  if (present) state.absent.clear();
  else state.roster.forEach((n) => state.absent.add(n));
  els.attendanceList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = present;
    cb.parentElement.classList.toggle("absent", !present);
  });
  updateAttendanceCount();
}

// --- constraint sets ---
function renderConstraintSets() {
  els.constraintSets.innerHTML = "";

  if (state.constraintSets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.style.fontStyle = "italic";
    empty.textContent = "No constraint groups yet.";
    els.constraintSets.appendChild(empty);
    return;
  }

  state.constraintSets.forEach((set) => {
    const wrap = document.createElement("div");
    wrap.className = "constraint-set";

    const header = document.createElement("div");
    header.className = "cs-header";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "cs-name";
    nameInput.value = set.name;
    nameInput.placeholder = "Name (e.g. High performers)";
    nameInput.addEventListener("input", () => { set.name = nameInput.value; });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "secondary cs-delete";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      state.constraintSets = state.constraintSets.filter((s) => s.id !== set.id);
      renderConstraintSets();
    });

    header.appendChild(nameInput);
    header.appendChild(delBtn);
    wrap.appendChild(header);

    const chips = document.createElement("div");
    chips.className = "cs-chips";
    sortedRoster().forEach((name) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "cs-chip";
      if (set.members.has(name)) chip.classList.add("selected");
      chip.textContent = name;
      chip.addEventListener("click", () => {
        if (set.members.has(name)) {
          set.members.delete(name);
          chip.classList.remove("selected");
        } else {
          set.members.add(name);
          chip.classList.add("selected");
        }
      });
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);

    els.constraintSets.appendChild(wrap);
  });
}

function addConstraintSet() {
  state.constraintSets.push({
    id: nextConstraintId++,
    name: "",
    members: new Set(),
  });
  renderConstraintSets();
}

// --- partition into group sizes ---
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

// --- assignment honoring constraint sets ---
// Greedy: place constraint-set members first (largest sets first), each into
// the group with the fewest existing same-set members and the most remaining
// capacity. Then fill the rest of the students into groups with capacity.
function assignWithConstraints(students, sizes, constraintSets) {
  const groups = sizes.map(() => []);
  const remaining = sizes.slice();

  // Active sets: constrain only members who are present, and only sets with
  // 2+ active members (a singleton set imposes no constraint).
  const activeSets = constraintSets
    .map((cs) => [...cs.members].filter((m) => students.includes(m)))
    .filter((members) => members.length >= 2);

  // student -> [setIndex, ...]
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
  // Larger constraint sets are harder to spread — handle them first.
  const orderedSets = activeSets
    .map((members, i) => ({ i, members }))
    .sort((a, b) => b.members.length - a.members.length);

  for (const { members } of orderedSets) {
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

  // Shuffle within each group so the constraint-anchored member isn't always
  // listed first.
  return groups.map((g) => shuffle(g));
}

// --- classroom rendering ---
function gridDims(n, target = ROOM_ASPECT) {
  let bestCols = n;
  let bestRows = 1;
  let bestScore = Infinity;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const aspect = cols / rows;
    const score = Math.abs(Math.log(aspect / target));
    if (score < bestScore) {
      bestScore = score;
      bestCols = cols;
      bestRows = rows;
    }
  }
  return { cols: bestCols, rows: bestRows };
}

function renderClassroom(groups) {
  els.groupsGrid.innerHTML = "";
  if (!groups || groups.length === 0) {
    showEmptyHint();
    return;
  }
  const { cols, rows } = gridDims(groups.length);
  els.groupsGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  els.groupsGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  groups.forEach((members, i) => {
    const g = document.createElement("div");
    g.className = "group";

    const h = document.createElement("div");
    h.className = "group-header";
    h.textContent = `Group ${i + 1}`;
    g.appendChild(h);

    const ul = document.createElement("ul");
    ul.className = "group-members";
    members.forEach((name) => {
      const li = document.createElement("li");
      li.textContent = name;
      ul.appendChild(li);
    });
    g.appendChild(ul);

    els.groupsGrid.appendChild(g);
  });
  fitGroupText();
}

function showEmptyHint() {
  els.groupsGrid.innerHTML = "";
  els.groupsGrid.style.gridTemplateColumns = "";
  els.groupsGrid.style.gridTemplateRows = "";
  const hint = document.createElement("div");
  hint.className = "empty-hint";
  hint.innerHTML = "<p>No groups yet.</p><p>Click <strong>Setup</strong> to load a roster and make groups.</p>";
  els.groupsGrid.appendChild(hint);
}

function fitGroupText() {
  const groupEls = els.groupsGrid.querySelectorAll(".group");
  groupEls.forEach((g) => {
    const list = g.querySelector(".group-members");
    if (!list) return;
    list.querySelectorAll("li").forEach((li) => (li.style.fontSize = ""));
    const firstLi = list.querySelector("li");
    if (!firstLi) return;
    let size = parseFloat(getComputedStyle(firstLi).fontSize);
    let guard = 30;
    while (
      (g.scrollHeight > g.clientHeight + 1 || list.scrollWidth > list.clientWidth + 1) &&
      size > 12 &&
      guard-- > 0
    ) {
      size -= 1;
      list.querySelectorAll("li").forEach((li) => (li.style.fontSize = `${size}px`));
    }
  });
}

// --- group-size selection ---
function getSelectedSizeRange() {
  const sel = document.querySelector('input[name="group-size"]:checked');
  const [a, b] = sel.value.split("-");
  return { min: Number(a), max: Number(b) };
}

// --- main actions ---
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
  const groups = assignWithConstraints(present, sizes, state.constraintSets);
  state.lastResult = groups;
  renderClassroom(groups);
  els.reshuffleBtn.disabled = false;
  return true;
}

function reshuffle() {
  // Re-runs assignment using current state (attendance, constraints, size).
  makeGroups();
}

// --- dialog open/close ---
function openSetup() { els.setupDialog.showModal(); }
function closeSetup() { els.setupDialog.close(); }

// --- wire up ---
els.setupBtn.addEventListener("click", openSetup);
els.closeSetupBtn.addEventListener("click", closeSetup);
els.closeSetupFooterBtn.addEventListener("click", closeSetup);
els.reshuffleBtn.addEventListener("click", reshuffle);
els.fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});

els.loadRosterBtn.addEventListener("click", () => {
  const names = parseRoster(els.rosterInput.value);
  if (names.length === 0) return;
  state.roster = names;
  // Drop stale absent entries and constraint members no longer in the roster.
  state.absent = new Set([...state.absent].filter((n) => state.roster.includes(n)));
  state.constraintSets.forEach((cs) => {
    cs.members = new Set([...cs.members].filter((n) => state.roster.includes(n)));
  });
  renderAttendance();
  renderConstraintSets();
  els.attendancePanel.hidden = false;
  els.constraintsPanel.hidden = false;
  els.groupingPanel.hidden = false;
});

els.clearRosterBtn.addEventListener("click", () => {
  els.rosterInput.value = "";
  state.roster = [];
  state.absent.clear();
  state.constraintSets = [];
  els.attendanceList.innerHTML = "";
  els.constraintSets.innerHTML = "";
  els.attendancePanel.hidden = true;
  els.constraintsPanel.hidden = true;
  els.groupingPanel.hidden = true;
  els.groupingError.hidden = true;
});

els.allPresentBtn.addEventListener("click", () => setAllAttendance(true));
els.allAbsentBtn.addEventListener("click", () => setAllAttendance(false));
els.addConstraintBtn.addEventListener("click", addConstraintSet);

els.makeGroupsBtn.addEventListener("click", () => {
  if (makeGroups()) closeSetup();
});

window.addEventListener("resize", () => {
  if (state.lastResult) fitGroupText();
});

// Open setup automatically on first load to nudge the user.
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", openSetup);
} else {
  openSetup();
}
