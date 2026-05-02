"use strict";

const ROOM_ASPECT = 1.5;

const els = {
  rosterInput: document.getElementById("roster-input"),
  loadRosterBtn: document.getElementById("load-roster-btn"),
  clearRosterBtn: document.getElementById("clear-roster-btn"),
  attendancePanel: document.getElementById("attendance-panel"),
  attendanceList: document.getElementById("attendance-list"),
  attendanceCount: document.getElementById("attendance-count"),
  allPresentBtn: document.getElementById("all-present-btn"),
  allAbsentBtn: document.getElementById("all-absent-btn"),
  groupingPanel: document.getElementById("grouping-panel"),
  makeGroupsBtn: document.getElementById("make-groups-btn"),
  groupingError: document.getElementById("grouping-error"),
  setupView: document.getElementById("setup-view"),
  classroomView: document.getElementById("classroom-view"),
  groupsGrid: document.getElementById("groups-grid"),
  backBtn: document.getElementById("back-btn"),
  reshuffleBtn: document.getElementById("reshuffle-btn"),
  fullscreenBtn: document.getElementById("fullscreen-btn"),
};

let roster = [];

function parseRoster(text) {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function renderAttendance() {
  els.attendanceList.innerHTML = "";
  roster.forEach((name, i) => {
    const id = `student-${i}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.checked = true;
    cb.dataset.index = String(i);
    cb.addEventListener("change", () => {
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

function getPresentStudents() {
  const checks = els.attendanceList.querySelectorAll('input[type="checkbox"]');
  const present = [];
  checks.forEach((cb) => {
    if (cb.checked) present.push(roster[Number(cb.dataset.index)]);
  });
  return present;
}

function updateAttendanceCount() {
  const total = roster.length;
  const present = getPresentStudents().length;
  els.attendanceCount.textContent = `${present} of ${total} present`;
}

function setAllAttendance(checked) {
  els.attendanceList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = checked;
    cb.parentElement.classList.toggle("absent", !checked);
  });
  updateAttendanceCount();
}

/**
 * Partition n students into groups whose sizes all fall in [min, max].
 * Returns an array of group sizes (e.g. [4,4,3]) or null if impossible.
 * Picks the number of groups that produces the most uniform sizes.
 */
function partitionSizes(n, min, max) {
  if (n <= 0) return null;
  if (min > max) return null;
  if (n < min) return null;
  const kMin = Math.ceil(n / max);
  const kMax = Math.floor(n / min);
  if (kMin > kMax) return null;

  // Prefer the smallest k whose ceil/floor split is most uniform
  // (uniform = all sizes equal). Among equally uniform options, fewer groups wins.
  let bestK = kMin;
  let bestSpread = Infinity;
  for (let k = kMin; k <= kMax; k++) {
    const remainder = n % k;
    const spread = remainder === 0 ? 0 : 1;
    if (spread < bestSpread) {
      bestSpread = spread;
      bestK = k;
    }
  }
  const k = bestK;
  const base = Math.floor(n / k);
  const extra = n % k;
  const sizes = [];
  // Put the larger groups first so toward-front groups are slightly larger
  // — purely cosmetic, doesn't affect anything.
  for (let i = 0; i < k; i++) sizes.push(i < extra ? base + 1 : base);
  return sizes;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeGroups(students, sizes) {
  const shuffled = shuffle(students);
  const groups = [];
  let idx = 0;
  for (const s of sizes) {
    groups.push(shuffled.slice(idx, idx + s));
    idx += s;
  }
  return groups;
}

/**
 * Pick a (cols, rows) grid for `numGroups` cells whose aspect ratio
 * (cols / rows) is closest to the target room aspect.
 */
function gridDims(numGroups, targetAspect = ROOM_ASPECT) {
  let bestCols = numGroups;
  let bestRows = 1;
  let bestScore = Infinity;
  for (let cols = 1; cols <= numGroups; cols++) {
    const rows = Math.ceil(numGroups / cols);
    const aspect = cols / rows;
    const score = Math.abs(Math.log(aspect / targetAspect));
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
  const { cols, rows } = gridDims(groups.length);
  els.groupsGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  els.groupsGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

  groups.forEach((members, i) => {
    const groupEl = document.createElement("div");
    groupEl.className = "group";

    const header = document.createElement("div");
    header.className = "group-header";
    header.textContent = `Group ${i + 1}`;
    groupEl.appendChild(header);

    const list = document.createElement("ul");
    list.className = "group-members";
    members.forEach((name) => {
      const li = document.createElement("li");
      li.textContent = name;
      list.appendChild(li);
    });
    groupEl.appendChild(list);

    els.groupsGrid.appendChild(groupEl);
  });

  fitGroupText();
}

/**
 * Shrink member-name font size if any group's content overflows its box,
 * so everything stays legible without manual tweaking.
 */
function fitGroupText() {
  const groupEls = els.groupsGrid.querySelectorAll(".group");
  groupEls.forEach((g) => {
    const list = g.querySelector(".group-members");
    if (!list) return;
    list.style.fontSize = "";
    let size = parseFloat(getComputedStyle(list.querySelector("li")).fontSize);
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

function getSelectedSizeRange() {
  const sel = document.querySelector('input[name="group-size"]:checked');
  const [minS, maxS] = sel.value.split("-");
  return { min: Number(minS), max: Number(maxS) };
}

let lastGroupedStudents = null;
let lastSizes = null;

function buildAndShowGroups() {
  els.groupingError.hidden = true;
  const present = getPresentStudents();
  const { min, max } = getSelectedSizeRange();
  const sizes = partitionSizes(present.length, min, max);
  if (!sizes) {
    els.groupingError.textContent =
      `Can't make groups of ${min === max ? min : min + "–" + max} from ${present.length} present students.`;
    els.groupingError.hidden = false;
    return;
  }
  lastGroupedStudents = present;
  lastSizes = sizes;
  const groups = makeGroups(present, sizes);
  els.setupView.hidden = true;
  els.classroomView.hidden = false;
  renderClassroom(groups);
}

function reshuffleCurrent() {
  if (!lastGroupedStudents || !lastSizes) return;
  const groups = makeGroups(lastGroupedStudents, lastSizes);
  renderClassroom(groups);
}

function backToSetup() {
  els.classroomView.hidden = true;
  els.setupView.hidden = false;
}

// Wire up
els.loadRosterBtn.addEventListener("click", () => {
  const names = parseRoster(els.rosterInput.value);
  if (names.length === 0) return;
  roster = names;
  renderAttendance();
  els.attendancePanel.hidden = false;
  els.groupingPanel.hidden = false;
  els.attendancePanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

els.clearRosterBtn.addEventListener("click", () => {
  els.rosterInput.value = "";
  roster = [];
  els.attendanceList.innerHTML = "";
  els.attendancePanel.hidden = true;
  els.groupingPanel.hidden = true;
  els.groupingError.hidden = true;
});

els.allPresentBtn.addEventListener("click", () => setAllAttendance(true));
els.allAbsentBtn.addEventListener("click", () => setAllAttendance(false));
els.makeGroupsBtn.addEventListener("click", buildAndShowGroups);
els.reshuffleBtn.addEventListener("click", reshuffleCurrent);
els.backBtn.addEventListener("click", backToSetup);
els.fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

window.addEventListener("resize", () => {
  if (!els.classroomView.hidden) fitGroupText();
});
