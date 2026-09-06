// main.js — 待办清单安卓版
// 界面逻辑与桌面版一致；数据源为 window.AppAPI（store.js + capacitor-sqlite）
let api = null;
let ctxTarget = null;

// 列表数据缓存（筛选/搜索时重新渲染用）
let lastActive = [];
let lastDone = [];
let searchQ = '';
let filterMode = 'all';
let filterTag = '';
let calTagFilter = '';

// 标签定义 [{name, color}]
let tagDefs = [];
const tagColors = ['#7c6cf0', '#4a90e2', '#3aa76d', '#e8a33d', '#e5534b', '#d357a5', '#5b5eae', '#8a8f3d'];
let selectedTagColor = tagColors[0];
let currentView = 'active';

// 对话框状态：null = 新建模式，数字 = 正在编辑的任务 id
let editingId = null;
let taskTag = ''; // 对话框里当前选中的标签（'' = 无标签）

function $(id) { return document.getElementById(id); }

function showError(msg) {
  const el = $('summary');
  if (el) el.textContent = '⚠ ' + msg;
}

window.onerror = function (msg, src, line) {
  showError('JS错误: ' + msg + ' (行' + line + ')');
  return false;
};
window.addEventListener('unhandledrejection', function (e) {
  showError('调用失败: ' + String(e.reason && e.reason.message ? e.reason.message : e.reason));
});

// ---------- 渲染 ----------
let refreshing = false;

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    try {
      const todos = await api.GetTodos();
      lastActive = todos.filter(t => !t.done);
      lastDone = todos.filter(t => t.done);
      renderAll();
      $('count-active').textContent = lastActive.length;
      $('count-done').textContent = lastDone.length;
      $('summary').textContent = lastActive.length > 0
        ? '还有 ' + lastActive.length + ' 件事待办'
        : (lastDone.length > 0 ? '全部完成，太棒了！' : '暂无任务，添加一条吧');
    } catch (err) {
      showError('读取失败: ' + String(err && err.message ? err.message : err));
    }
  } finally {
    refreshing = false;
  }
}

function renderAll() {
  renderActive(filterActive(lastActive));
  renderDone(filterDone(lastDone));
  renderCalendar();
}

function formatDue(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  const md = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '年' + md;
}

// 构造一条任务卡片
function buildTodoItem(t, isDone) {
  const li = document.createElement('li');
  li.className = 'todo-item' + (isDone ? ' done' : '') + (!isDone && t.urge ? ' urged' : '');
  li.dataset.id = t.id;

  const cb = document.createElement('button');
  cb.className = 'check';
  cb.textContent = isDone ? '✓' : '';
  cb.title = isDone ? '恢复为未完成' : '标记完成';
  cb.addEventListener('click', function () { toggle(Number(li.dataset.id)); });

  const span = document.createElement('span');
  span.className = 'title';
  span.textContent = t.title;

  const grip = document.createElement('span');
  grip.className = 'grip';
  grip.textContent = '⠿';

  li.append(cb, span, grip);

  // meta 行：手机上换行显示在标题下方（桌面端 display:contents，保持原布局）
  const meta = document.createElement('div');
  meta.className = 'meta-row';
  li.insertBefore(meta, grip);

  // 标签
  if (t.tag) {
    const def = tagDefs.find(function (d) { return d.name === t.tag; });
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    dot.style.background = def ? def.color : '#9b95ad';
    chip.append(dot, document.createTextNode(t.tag));
    meta.appendChild(chip);
  }

  if (t.due_at) {
    const due = document.createElement('span');
    due.className = 'due' + (!isDone && t.due_at * 1000 < Date.now() ? ' overdue' : '');
    due.textContent = '📅 ' + formatDue(t.due_at);
    meta.appendChild(due);
  }

  // 备注：有内容时显示图标，点击进入编辑
  if (t.note) {
    const noteIcon = document.createElement('button');
    noteIcon.className = 'note-icon';
    noteIcon.textContent = '🗒';
    noteIcon.title = t.note;
    noteIcon.addEventListener('click', function () { openEditDialog(t); });
    meta.appendChild(noteIcon);
  }

  if (!isDone && t.urge) {
    const badge = document.createElement('span');
    badge.className = 'urge-badge';
    badge.textContent = '⚡ 督促';
    meta.appendChild(badge);
  }

  // 手机上点卡片直接进入编辑（避开勾选/备注/标签，长按后短暂冷却）
  li.addEventListener('click', function (e) {
    if (!window.matchMedia('(max-width: 700px)').matches) return;
    if (e.target.closest('.check') || e.target.closest('.note-icon') || e.target.closest('.tag-chip')) return;
    if (Date.now() - lastLongPress < 700) return;
    openEditDialog(t);
  });
  return li;
}

function emptyHint(text) {
  const div = document.createElement('div');
  div.className = 'empty-hint';
  div.textContent = text;
  return div;
}

function renderActive(items) {
  const view = $('active-view');
  view.innerHTML = '';
  if (items.length === 0) {
    const filtered = searchQ !== '' || filterMode !== 'all' || filterTag !== '';
    view.appendChild(emptyHint(filtered ? '没有符合条件的任务' : '暂无任务，点右上角新建吧'));
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'todo-list';
  for (const t of items) ul.appendChild(buildTodoItem(t, false));
  view.appendChild(ul);
}

function monthKey(ts) {
  const d = new Date(ts * 1000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function monthLabel(key) {
  const parts = key.split('-');
  return parts[0] + '年' + Number(parts[1]) + '月';
}

// 已完成按年月分组：最近完成的月份在最上面，组内按完成时间倒序
function renderDone(items) {
  const wrap = $('done-view');
  wrap.innerHTML = '';
  if (items.length === 0) {
    const filtered = searchQ !== '' || filterTag !== '';
    wrap.appendChild(emptyHint(filtered ? '没有符合条件的任务' : '还没有完成的任务'));
    return;
  }
  const groups = {};
  for (const t of items) {
    const ts = t.completed_at || t.created_at || 0;
    const key = monthKey(ts);
    (groups[key] = groups[key] || []).push({ t: t, ts: ts });
  }
  const keys = Object.keys(groups).sort().reverse();
  for (const key of keys) {
    const group = document.createElement('div');
    group.className = 'month-group';

    const title = document.createElement('div');
    title.className = 'month-title';
    const name = document.createElement('span');
    name.textContent = monthLabel(key);
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = groups[key].length;
    title.append(name, count);

    const ul = document.createElement('ul');
    ul.className = 'todo-list';
    groups[key]
      .sort(function (a, b) { return b.ts - a.ts || b.t.id - a.t.id; })
      .forEach(function (e) { ul.appendChild(buildTodoItem(e.t, true)); });

    group.append(title, ul);
    wrap.appendChild(group);
  }
}

// ---------- 搜索与筛选 ----------
function matchSearch(t) {
  return !searchQ || t.title.toLowerCase().includes(searchQ);
}

function matchTag(t) {
  return !filterTag || t.tag === filterTag;
}

function filterActive(items) {
  const now = Date.now() / 1000;
  return items.filter(function (t) {
    if (!matchSearch(t) || !matchTag(t)) return false;
    switch (filterMode) {
      case 'week': return !!t.due_at && t.due_at > now && t.due_at <= now + 7 * 86400;
      case 'overdue': return !!t.due_at && t.due_at < now;
      case 'urge': return !!t.urge;
      default: return true;
    }
  });
}

function filterDone(items) {
  return items.filter(function (t) { return matchSearch(t) && matchTag(t); });
}

$('search-box').addEventListener('input', function () {
  searchQ = this.value.trim().toLowerCase();
  renderAll();
});

$('filter-select').addEventListener('change', function () {
  filterMode = this.value;
  renderAll();
});

$('tag-select').addEventListener('change', function () {
  filterTag = this.value;
  renderAll();
});

// 手机端：胶囊筛选条（替代原生下拉）
function updateChipSelection(row, chip) {
  row.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('selected', c === chip); });
}

$('filter-chips').addEventListener('click', function (e) {
  const chip = e.target.closest('.chip');
  if (!chip || chip.classList.contains('selected')) return;
  filterMode = chip.dataset.mode;
  $('filter-select').value = filterMode;
  updateChipSelection(this, chip);
  renderAll();
});

$('tag-chips').addEventListener('click', function (e) {
  const chip = e.target.closest('.chip');
  if (!chip || chip.classList.contains('selected')) return;
  filterTag = chip.dataset.tag;
  $('tag-select').value = filterTag;
  updateChipSelection(this, chip);
  renderAll();
});

// ---------- 视图切换 ----------
function switchView(view) {
  currentView = view;
  const isActive = view === 'active';
  const isDone = view === 'done';
  const isCal = view === 'calendar';
  const isSettings = view === 'settings';
  $('tab-active').classList.toggle('active', isActive);
  $('tab-done').classList.toggle('active', isDone);
  $('tab-calendar').classList.toggle('active', isCal);
  $('tab-settings').classList.toggle('active', isSettings);
  $('active-view').classList.toggle('hidden', !isActive);
  $('done-view').classList.toggle('hidden', !isDone);
  $('calendar-view').classList.toggle('hidden', !isCal);
  $('settings-view').classList.toggle('hidden', !isSettings);
  $('filter-bar').classList.toggle('hidden', isCal || isSettings);
  $('view-title').textContent = isActive ? '未完成' : (isDone ? '已完成' : (isCal ? '月历' : '设置'));
  $('filter-select').disabled = !isActive;
  $('tag-select').disabled = !isActive && !isDone;
  // 截止时间筛选仅对未完成视图有意义（手机胶囊条同步隐藏）
  const fc = $('filter-chips');
  if (fc) fc.classList.toggle('hidden', !isActive);
}

$('tab-active').addEventListener('click', function () { switchView('active'); });
$('tab-done').addEventListener('click', function () { switchView('done'); });
$('tab-calendar').addEventListener('click', function () { switchView('calendar'); });
$('tab-settings').addEventListener('click', function () {
  switchView('settings');
  loadTags();
  loadTrash();
});

// ---------- 刷新 ----------
// 手动刷新：重新拉取数据，督促/逾期状态会按当前时间重算
$('refresh-btn').addEventListener('click', async function () {
  const btn = this;
  btn.classList.remove('spinning');
  void btn.offsetWidth; // 强制重排以重新触发旋转动画
  btn.classList.add('spinning');
  await refresh();
});

// 自动重检：应用久开时也能及时发现跨过截止时间/督促期的任务。
// 右键菜单打开时跳过，避免菜单被重渲染吃掉
setInterval(function () {
  if ($('ctx-menu').classList.contains('hidden')) refresh();
}, 60000);

// ---------- 操作 ----------
function findTodo(id) {
  return lastActive.concat(lastDone).find(function (t) { return t.id === id; });
}

async function toggle(id) {
  try { await api.ToggleTodo(id); } catch (err) { showError('操作失败'); }
  await refresh();
}

async function removeTodo(id) {
  try { await api.DeleteTodo(id); } catch (err) { showError('删除失败'); }
  await refresh();
}

// ---------- 长按菜单（触屏）/ 右键菜单 ----------
document.addEventListener('contextmenu', function (e) {
  const li = e.target.closest('.todo-item');
  if (!li) return;
  e.preventDefault();
  ctxTarget = li;
  showMenu(e.clientX, e.clientY, li.classList.contains('done'));
});

// 触屏长按 500ms 弹出菜单
let lpTimer = null;
let lpMoved = false;
let lastLongPress = 0;
document.addEventListener('touchstart', function (e) {
  const li = e.target.closest('.todo-item');
  if (!li) return;
  lpMoved = false;
  const t = e.touches[0];
  const startX = t.clientX;
  const startY = t.clientY;
  lpTimer = setTimeout(function () {
    if (lpMoved) return;
    lastLongPress = Date.now();
    ctxTarget = li;
    showMenu(startX, startY, li.classList.contains('done'));
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* 忽略 */ } }
  }, 500);
}, { passive: true });
document.addEventListener('touchmove', function () {
  lpMoved = true;
  if (lpTimer) clearTimeout(lpTimer);
}, { passive: true });
document.addEventListener('touchend', function () {
  if (lpTimer) clearTimeout(lpTimer);
}, { passive: true });

function showMenu(x, y, isDone) {
  const menu = $('ctx-menu');
  menu.innerHTML = '';
  const id = Number(ctxTarget.dataset.id);
  const items = [
    { label: '编辑任务', fn: function () { const t = findTodo(id); if (t) openEditDialog(t); } }
  ];
  if (isDone) {
    items.push({ label: '恢复为未完成', fn: function () { toggle(id); } });
  } else {
    items.push({ label: '标记完成', fn: function () { toggle(id); } });
  }
  items.push({ label: '删除任务', danger: true, fn: function () { removeTodo(id); } });

  for (const it of items) {
    const b = document.createElement('button');
    b.textContent = it.label;
    if (it.danger) b.className = 'danger';
    b.addEventListener('click', function () { hideMenu(); it.fn(); });
    menu.appendChild(b);
  }
  menu.classList.remove('hidden');
  // 手机上是底部操作单（定位交给 CSS）；桌面才跟随点击位置
  if (!window.matchMedia('(max-width: 700px)').matches) {
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
  } else {
    menu.style.left = '';
    menu.style.top = '';
  }
}

function hideMenu() { $('ctx-menu').classList.add('hidden'); }
document.addEventListener('click', hideMenu);
window.addEventListener('blur', hideMenu);

// ---------- 新建 / 编辑任务对话框 ----------
const overlay = $('modal-overlay');

function resetForm() {
  $('task-title').value = '';
  $('task-due').value = '';
  $('task-urge').value = '3';
  $('task-urge').disabled = true;
  $('task-note').value = '';
  taskTag = '';
  $('task-tag').value = '';
  renderTaskTagChips();
  $('task-title').classList.remove('invalid');
  $('title-error').classList.add('hidden');
}

function openDialog() {
  editingId = null;
  $('dialog-title').textContent = '新建任务';
  $('submit-btn').textContent = '创建任务';
  resetForm();
  overlay.classList.remove('hidden');
  $('task-title').focus();
}

function toLocalInput(ts) {
  const d = new Date(ts * 1000);
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function openEditDialog(t) {
  editingId = t.id;
  $('dialog-title').textContent = '编辑任务';
  $('submit-btn').textContent = '保存修改';
  resetForm();
  $('task-title').value = t.title;
  taskTag = t.tag || '';
  if (taskTag && !tagDefs.some(function (d) { return d.name === taskTag; })) {
    // 标签可能已被删除：下拉里补一个选项以便回显
    const opt = document.createElement('option');
    opt.value = taskTag;
    opt.textContent = taskTag + '（已删除）';
    $('task-tag').appendChild(opt);
  }
  $('task-tag').value = taskTag;
  renderTaskTagChips();
  if (t.due_at) {
    $('task-due').value = toLocalInput(t.due_at);
    $('task-urge').disabled = false;
    $('task-urge').value = (t.urge_days != null && t.urge_days >= 0) ? t.urge_days : 3;
  }
  $('task-note').value = t.note || '';
  overlay.classList.remove('hidden');
  $('task-title').focus();
}

function closeDialog() { overlay.classList.add('hidden'); }

$('new-task-btn').addEventListener('click', openDialog);
$('fab-new').addEventListener('click', openDialog);
$('cancel-btn').addEventListener('click', closeDialog);
overlay.addEventListener('mousedown', function (e) {
  if (e.target === overlay) closeDialog();
});
overlay.addEventListener('touchstart', function (e) {
  if (e.target === overlay) closeDialog();
}, { passive: true });
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeDialog();
});

$('task-title').addEventListener('input', function () {
  this.classList.remove('invalid');
  $('title-error').classList.add('hidden');
});

// 填了截止时间才允许设置督促时间
$('task-due').addEventListener('input', function () {
  $('task-urge').disabled = !this.value;
});

$('task-title').addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    $('task-form').requestSubmit();
  }
});

$('task-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const titleEl = $('task-title');
  const title = titleEl.value.trim();
  if (!title) {
    titleEl.classList.add('invalid');
    $('title-error').classList.remove('hidden');
    titleEl.focus();
    return;
  }
  const note = $('task-note').value.trim();
  const tag = taskTag;
  const dueRaw = $('task-due').value;
  let dueAt = null;
  let urgeDays = 3;
  if (dueRaw) {
    const ms = new Date(dueRaw).getTime();
    if (!isNaN(ms)) {
      dueAt = Math.floor(ms / 1000);
      const n = parseInt($('task-urge').value, 10);
      if (!isNaN(n) && n >= 0) urgeDays = n;
    }
  }
  try {
    if (editingId != null) {
      await api.UpdateTodo(editingId, title, dueAt, urgeDays, note, tag);
    } else {
      await api.AddTodo(title, dueAt, urgeDays, note, tag);
    }
  } catch (err) {
    showError(editingId != null ? '保存失败' : '添加失败');
  }
  closeDialog();
  await refresh();
});

// ---------- 设置：加载与应用 ----------
async function loadSettings() {
  if (!api || !api.GetSettings) return;
  try {
    const s = await api.GetSettings();
    if (s) {
      settings.darkMode = !!s.dark_mode;
      if (s.new_task_hotkey) settings.newTaskHotkey = s.new_task_hotkey;
    }
  } catch (err) { /* 读取失败时用默认设置 */ }
  applySettings();
}

function applySettings() {
  document.body.classList.toggle('dark', settings.darkMode);
  $('darkmode-switch').classList.toggle('on', settings.darkMode);
  if ($('hotkey-btn')) $('hotkey-btn').textContent = settings.newTaskHotkey.split('+').join(' + ');
}

async function saveSettings() {
  if (!api || !api.SaveSettings) return;
  try {
    await api.SaveSettings(settings.darkMode, settings.newTaskHotkey);
  } catch (err) {
    showError('保存设置失败');
  }
}

$('darkmode-switch').addEventListener('click', function () {
  settings.darkMode = !settings.darkMode;
  applySettings();
  saveSettings();
});

// ---------- 设置：数据导出 / 导入 ----------
function flashBtn(btn, text) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(function () {
    btn.textContent = orig;
    delete btn.dataset.busy;
  }, 2400);
}

const exportBtn = $('export-btn');
if (exportBtn) {
  exportBtn.addEventListener('click', async function () {
    if (!api || !api.ExportTodos) return;
    try {
      const n = await api.ExportTodos();
      if (n > 0) flashBtn(this, '✓ 已导出 ' + n + ' 条');
    } catch (err) {
      showError('导出失败');
    }
  });
}
const importBtn = $('import-btn');
if (importBtn) {
  importBtn.addEventListener('click', async function () {
    if (!api || !api.ImportTodos) return;
    try {
      const res = await api.ImportTodos();
      if (res && (res.imported > 0 || res.skipped > 0)) {
        await refresh();
        flashBtn(this, '✓ 导入 ' + res.imported + ' 条' + (res.skipped > 0 ? ' · 跳过 ' + res.skipped : ''));
      }
    } catch (err) {
      showError(String(err && err.message ? err.message : '导入失败'));
    }
  });
}

// ---------- 标签 ----------
async function loadTags() {
  if (!api || !api.GetTags) return;
  try {
    tagDefs = (await api.GetTags()) || [];
  } catch (err) {
    tagDefs = [];
  }
  refreshTagSelects();
  renderAll();
  if (currentView === 'settings') renderTagManager();
}

// 重建对话框 / 筛选栏 / 月历里的标签下拉
function refreshTagSelects() {
  const dialog = $('task-tag');
  dialog.innerHTML = '';
  dialog.appendChild(new Option('无标签', ''));
  for (const d of tagDefs) dialog.appendChild(new Option(d.name, d.name));

  const filter = $('tag-select');
  filter.innerHTML = '';
  filter.appendChild(new Option('全部标签', ''));
  for (const d of tagDefs) filter.appendChild(new Option(d.name, d.name));
  if (filterTag && !tagDefs.some(function (d) { return d.name === filterTag; })) filterTag = '';
  filter.value = filterTag;

  const cal = $('cal-tag-select');
  cal.innerHTML = '';
  cal.appendChild(new Option('全部标签', ''));
  for (const d of tagDefs) cal.appendChild(new Option(d.name, d.name));
  if (calTagFilter && !tagDefs.some(function (d) { return d.name === calTagFilter; })) calTagFilter = '';
  cal.value = calTagFilter;

  // 手机端标签胶囊条
  const chipRow = $('tag-chips');
  chipRow.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'chip' + (filterTag === '' ? ' selected' : '');
  allBtn.dataset.tag = '';
  allBtn.textContent = '全部标签';
  chipRow.appendChild(allBtn);
  for (const d of tagDefs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (filterTag === d.name ? ' selected' : '');
    b.dataset.tag = d.name;
    b.textContent = d.name;
    chipRow.appendChild(b);
  }

  renderTaskTagChips();
  renderCalTagChips();
}

// 对话框里的标签胶囊（带颜色圆点；手机端替代原生下拉）
function renderTaskTagChips() {
  const row = $('task-tag-chips');
  if (!row) return;
  row.innerHTML = '';
  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'chip' + (taskTag === '' ? ' selected' : '');
  none.dataset.tag = '';
  none.textContent = '无标签';
  row.appendChild(none);
  let hasCurrent = taskTag === '';
  for (const d of tagDefs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (taskTag === d.name ? ' selected' : '');
    b.dataset.tag = d.name;
    if (taskTag === d.name) hasCurrent = true;
    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    dot.style.background = d.color;
    b.append(dot, document.createTextNode(d.name));
    row.appendChild(b);
  }
  // 标签被删除但任务还在用它：补一个选中态的标签便于保留或改选
  if (!hasCurrent && taskTag) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip selected';
    b.dataset.tag = taskTag;
    b.textContent = taskTag + '（已删除）';
    row.appendChild(b);
  }
}

// 月历里的标签胶囊（手机端替代原生下拉）
function renderCalTagChips() {
  const row = $('cal-tag-chips');
  if (!row) return;
  row.innerHTML = '';
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'chip' + (calTagFilter === '' ? ' selected' : '');
  all.dataset.tag = '';
  all.textContent = '全部标签';
  row.appendChild(all);
  for (const d of tagDefs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (calTagFilter === d.name ? ' selected' : '');
    b.dataset.tag = d.name;
    b.textContent = d.name;
    row.appendChild(b);
  }
}

$('task-tag').addEventListener('change', function () {
  taskTag = this.value;
  renderTaskTagChips();
});

$('task-tag-chips').addEventListener('click', function (e) {
  const chip = e.target.closest('.chip');
  if (!chip || chip.classList.contains('selected')) return;
  taskTag = chip.dataset.tag;
  $('task-tag').value = taskTag;
  updateChipSelection(this, chip);
});

$('cal-tag-chips').addEventListener('click', function (e) {
  const chip = e.target.closest('.chip');
  if (!chip || chip.classList.contains('selected')) return;
  calTagFilter = chip.dataset.tag;
  $('cal-tag-select').value = calTagFilter;
  updateChipSelection(this, chip);
  renderCalendar();
});

function renderSwatches() {
  const row = $('tag-color-row');
  row.innerHTML = '';
  for (const c of tagColors) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'swatch' + (c === selectedTagColor ? ' selected' : '');
    s.style.background = c;
    s.title = c;
    s.addEventListener('click', function () {
      selectedTagColor = c;
      renderSwatches();
    });
    row.appendChild(s);
  }
}

function renderTagManager() {
  renderSwatches();
  const wrap = $('tag-list');
  wrap.innerHTML = '';
  if (tagDefs.length === 0) {
    wrap.appendChild(emptyHint('还没有标签，在下方添加一个吧'));
    return;
  }
  for (const d of tagDefs) {
    const row = document.createElement('div');
    row.className = 'tag-row';

    const dot = document.createElement('span');
    dot.className = 'tag-dot';
    dot.style.background = d.color;

    const name = document.createElement('span');
    name.className = 'tag-name';
    name.textContent = d.name;

    const count = lastActive.concat(lastDone).filter(function (t) { return t.tag === d.name; }).length;
    const cnt = document.createElement('span');
    cnt.className = 'count';
    cnt.textContent = count;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'trash-btn danger';
    del.textContent = '删除';
    del.addEventListener('click', function () {
      if (!del.dataset.armed) {
        del.dataset.armed = '1';
        del.textContent = '确认删除？';
        setTimeout(function () {
          if (del.dataset.armed) {
            delete del.dataset.armed;
            del.textContent = '删除';
          }
        }, 3000);
        return;
      }
      deleteTag(d.name);
    });

    row.append(dot, name, cnt, del);
    wrap.appendChild(row);
  }
}

async function deleteTag(name) {
  try {
    await api.DeleteTag(name);
  } catch (err) {
    showError('删除标签失败');
    return;
  }
  await loadTags();
  await loadTrash();
}

$('add-tag-btn').addEventListener('click', async function () {
  const input = $('new-tag-name');
  const name = input.value.trim();
  if (!name) return;
  if (tagDefs.some(function (d) { return d.name === name; })) {
    input.classList.add('invalid');
    return;
  }
  input.classList.remove('invalid');
  tagDefs.push({ name: name, color: selectedTagColor });
  try {
    await api.SaveTags(tagDefs);
  } catch (err) {
    showError('保存标签失败');
    return;
  }
  input.value = '';
  await loadTags();
});
$('new-tag-name').addEventListener('input', function () {
  this.classList.remove('invalid');
});

// ---------- 回收站 ----------
function twoClickConfirm(btn, action) {
  if (btn.dataset.armed) {
    delete btn.dataset.armed;
    btn.classList.remove('armed');
    btn.textContent = btn.dataset.orig;
    action();
    return;
  }
  btn.dataset.armed = '1';
  btn.dataset.orig = btn.textContent;
  btn.classList.add('armed');
  btn.textContent = '确认？';
  setTimeout(function () {
    if (btn.dataset.armed) {
      delete btn.dataset.armed;
      btn.classList.remove('armed');
      btn.textContent = btn.dataset.orig;
    }
  }, 3000);
}

async function loadTrash() {
  if (!api || !api.GetTrash) return;
  const wrap = $('trash-list');
  wrap.innerHTML = '';
  let items = [];
  try {
    items = (await api.GetTrash()) || [];
  } catch (err) {
    return;
  }
  if (items.length === 0) {
    wrap.appendChild(emptyHint('回收站是空的'));
    return;
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'trash-row';

    const info = document.createElement('div');
    info.className = 'trash-info';
    const title = document.createElement('div');
    title.className = 'trash-title' + (it.done ? ' done' : '');
    title.textContent = it.title;
    const meta = document.createElement('div');
    meta.className = 'trash-meta';
    meta.textContent = '删除于 ' + formatDue(it.deleted_at) + (it.tag ? ' · ' + it.tag : '');
    info.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'settings-btns';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'settings-btn';
    restore.textContent = '恢复';
    restore.addEventListener('click', async function () {
      try { await api.RestoreTodo(it.id); } catch (err) { showError('恢复失败'); return; }
      await loadTrash();
      await refresh();
    });
    const purge = document.createElement('button');
    purge.type = 'button';
    purge.className = 'settings-btn danger-btn';
    purge.textContent = '彻底删除';
    purge.addEventListener('click', async function () {
      try { await api.PurgeTrash(it.id); } catch (err) { showError('删除失败'); return; }
      await loadTrash();
    });
    actions.append(restore, purge);

    row.append(info, actions);
    wrap.appendChild(row);
  }
}

const clearTrashBtn = $('clear-trash-btn');
if (clearTrashBtn) {
  clearTrashBtn.addEventListener('click', function () {
    twoClickConfirm(this, async function () {
      try { await api.ClearTrash(); } catch (err) { showError('清空失败'); return; }
      await loadTrash();
    });
  });
}

// ---------- 月历视图 ----------
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth() + 1; // 1~12
let calSelected = null; // 'YYYY-MM-DD' 或 null
let calSwipe = null;       // 跟手滑动状态
let calCommitting = false; // 提交动画进行中（期间忽略新的触摸）

function dateStr(y, m, d) {
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function dueTasksByDate() {
  const map = {};
  for (const t of lastActive) {
    if (!t.due_at) continue;
    if (calTagFilter && t.tag !== calTagFilter) continue;
    const d = new Date(t.due_at * 1000);
    const key = dateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
    (map[key] = map[key] || []).push(t);
  }
  return map;
}

// 把某年某月的日历网格填入指定容器（当前月 / 跟手滑动的相邻月共用）
function fillGrid(gridEl, year, month, byDate, nowSec, selectedKey) {
  gridEl.innerHTML = '';

  for (const w of ['一', '二', '三', '四', '五', '六', '日']) {
    const wd = document.createElement('div');
    wd.className = 'cal-weekday';
    wd.textContent = '周' + w;
    gridEl.appendChild(wd);
  }

  const now = new Date();
  const todayKey = dateStr(now.getFullYear(), now.getMonth() + 1, now.getDate());

  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7; // 周一为第一列
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevDays = new Date(year, month - 1, 0).getDate();

  const cells = [];
  for (let i = offset - 1; i >= 0; i--) cells.push({ d: prevDays - i, other: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d: d, other: false });
  let nextD = 1;
  while (cells.length % 7 !== 0 || cells.length < 35) cells.push({ d: nextD++, other: true });

  for (const cell of cells) {
    const el = document.createElement('div');
    el.className = 'cal-cell' + (cell.other ? ' other-month' : '');

    const num = document.createElement('div');
    num.className = 'cal-day-num';
    num.textContent = cell.d;
    el.appendChild(num);

    if (!cell.other) {
      const key = dateStr(year, month, cell.d);
      if (key === todayKey) el.classList.add('today');
      if (selectedKey && key === selectedKey) el.classList.add('selected');

      const list = byDate[key] || [];
      if (list.length > 0) {
        const hasOverdue = list.some(function (t) { return t.due_at < nowSec; });
        const hasUrge = list.some(function (t) { return t.urge && t.due_at >= nowSec; });
        const chip = document.createElement('span');
        chip.className = 'cal-chip' + (hasOverdue ? ' overdue' : (hasUrge ? ' urge' : ''));
        chip.textContent = list.length + ' 项截止';
        el.appendChild(chip);
      }
      el.addEventListener('click', function () {
        calSelected = calSelected === key ? null : key;
        renderCalendar();
      });
    }
    gridEl.appendChild(el);
  }
}

function renderCalendar() {
  if (calSwipe && calSwipe.dir) return; // 跟手滑动进行中，避免重渲染打断
  fillGrid($('cal-grid'), calYear, calMonth, dueTasksByDate(), Date.now() / 1000, calSelected);
  $('cal-title').textContent = calYear + '年' + calMonth + '月';
  renderCalDayPanel(dueTasksByDate());
}

function renderCalDayPanel(byDate) {
  const panel = $('cal-day-panel');
  if (!calSelected) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  const parts = calSelected.split('-').map(Number);
  const list = byDate[calSelected] || [];
  const weekday = '周' + '日一二三四五六'[new Date(parts[0], parts[1] - 1, parts[2]).getDay()];
  panel.classList.remove('hidden');
  panel.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'cal-day-title';
  title.textContent = (parts[1]) + '月' + parts[2] + '日 ' + weekday + ' · ' + list.length + ' 项截止';
  panel.appendChild(title);

  if (list.length === 0) {
    panel.appendChild(emptyHint('这一天没有截止的任务'));
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'todo-list';
  for (const t of list) ul.appendChild(buildTodoItem(t, false));
  panel.appendChild(ul);
}

function calShiftMonth(delta) {
  // ‹ › 按钮：相邻月滑入，当前月滑出（与跟手滑动同一套表现）
  if (calCommitting) return;
  const box = $('cal-grid-box');
  const grid = $('cal-grid');
  let ny = calYear, nm = calMonth + delta;
  if (nm < 1) { nm = 12; ny--; }
  if (nm > 12) { nm = 1; ny++; }
  calCommitting = true;

  const n = document.createElement('div');
  n.className = 'cal-grid cal-grid-neighbor';
  n.style.pointerEvents = 'none';
  fillGrid(n, ny, nm, dueTasksByDate(), Date.now() / 1000, null);
  n.style.left = delta > 0 ? '100%' : '-100%';
  box.appendChild(n);

  grid.classList.add('cal-swipe-anim');
  n.classList.add('cal-swipe-anim');
  void grid.offsetWidth; // 先提交起始状态，保证过渡一定播放
  grid.style.transform = 'translateX(' + (-delta * box.clientWidth) + 'px)';
  n.style.transform = 'translateX(' + (-delta * box.clientWidth) + 'px)';
  setTimeout(function () {
    calYear = ny;
    calMonth = nm;
    calSelected = null;
    renderCalendar();
    grid.style.transform = '';
    grid.classList.remove('cal-swipe-anim');
    n.remove();
    calCommitting = false;
  }, 210);
}

$('cal-prev').addEventListener('click', function () { calShiftMonth(-1); });
$('cal-next').addEventListener('click', function () { calShiftMonth(1); });

// 月历：跟手滑动切换月份 —— 当月与相邻月两块网格实时跟随手指，
// 松手超过阈值滑入相邻月，否则弹回
(function () {
  const box = document.getElementById('cal-grid-box');
  if (!box) return;

  box.addEventListener('touchstart', function (e) {
    if (calCommitting || e.touches.length !== 1) return;
    calSwipe = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      t: Date.now(),
      dir: 0,
      dx: 0,
      w: box.clientWidth || 1,
      grid: null,
      neighbor: null
    };
  }, { passive: true });

  box.addEventListener('touchmove', function (e) {
    if (!calSwipe) return;
    const t = e.touches[0];
    const dx = t.clientX - calSwipe.x;
    const dy = t.clientY - calSwipe.y;
    if (!calSwipe.dir) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) > Math.abs(dx)) { calSwipe = null; return; } // 让位给纵向滚动
      calSwipe.dir = dx < 0 ? 1 : -1;
      // 预生成相邻月网格，放在旁边一起跟手移动
      let ny = calYear, nm = calMonth + calSwipe.dir;
      if (nm < 1) { nm = 12; ny--; }
      if (nm > 12) { nm = 1; ny++; }
      const n = document.createElement('div');
      n.className = 'cal-grid cal-grid-neighbor';
      n.style.pointerEvents = 'none';
      fillGrid(n, ny, nm, dueTasksByDate(), Date.now() / 1000, null);
      n.style.left = calSwipe.dir > 0 ? '100%' : '-100%';
      box.appendChild(n);
      calSwipe.neighbor = n;
      calSwipe.grid = $('cal-grid');
    }
    calSwipe.dx = Math.max(-calSwipe.w, Math.min(calSwipe.w, dx));
    calSwipe.grid.style.transform = 'translateX(' + calSwipe.dx + 'px)';
    calSwipe.neighbor.style.transform = 'translateX(' + calSwipe.dx + 'px)';
  }, { passive: true });

  function finish(commit) {
    const s = calSwipe;
    calSwipe = null;
    if (!s || !s.dir) return;
    s.grid.classList.add('cal-swipe-anim');
    s.neighbor.classList.add('cal-swipe-anim');
    if (commit) {
      // 滑入相邻月：动画结束后原地重建为该月内容，无跳变
      calCommitting = true;
      s.grid.style.transform = 'translateX(' + (-s.dir * s.w) + 'px)';
      s.neighbor.style.transform = 'translateX(' + (-s.dir * s.w) + 'px)';
      setTimeout(function () {
        calMonth += s.dir;
        if (calMonth < 1) { calMonth = 12; calYear--; }
        if (calMonth > 12) { calMonth = 1; calYear++; }
        calSelected = null;
        renderCalendar();
        s.grid.style.transform = '';
        s.grid.classList.remove('cal-swipe-anim');
        s.neighbor.remove();
        calCommitting = false;
      }, 210);
    } else {
      // 弹回当前月
      s.grid.style.transform = 'translateX(0)';
      s.neighbor.style.transform = 'translateX(0)';
      setTimeout(function () {
        s.neighbor.remove();
        s.grid.style.transform = '';
        s.grid.classList.remove('cal-swipe-anim');
      }, 220);
    }
  }

  box.addEventListener('touchend', function () {
    if (!calSwipe) return;
    const elapsed = Date.now() - calSwipe.t;
    const commit = calSwipe.dir !== 0 &&
      (Math.abs(calSwipe.dx) > calSwipe.w * 0.25 || (elapsed < 260 && Math.abs(calSwipe.dx) > 45));
    finish(commit);
  }, { passive: true });

  box.addEventListener('touchcancel', function () {
    if (calSwipe) finish(false);
  }, { passive: true });
})();
$('cal-today').addEventListener('click', function () {
  const now = new Date();
  const delta = (now.getFullYear() * 12 + now.getMonth()) - (calYear * 12 + calMonth - 1);
  calYear = now.getFullYear();
  calMonth = now.getMonth() + 1;
  calSelected = dateStr(calYear, calMonth, now.getDate());
  renderCalendar();
  if (delta !== 0) {
    const grid = $('cal-grid');
    grid.classList.remove('cal-enter-left', 'cal-enter-right');
    void grid.offsetWidth;
    grid.classList.add(delta > 0 ? 'cal-enter-right' : 'cal-enter-left');
  }
});

const calTagSelect = $('cal-tag-select');
if (calTagSelect) {
  calTagSelect.addEventListener('change', function () {
    calTagFilter = this.value;
    renderCalendar();
  });
}

// ---------- 设置里的桌面专属功能在手机上隐藏 ----------
function hideDesktopOnlyGroups() {
  if (!api) return;
  if (api.GetAutoStart === undefined) {
    const g = $('system-group');
    if (g) g.classList.add('hidden');
  }
  if (api.ExportTodos === undefined) {
    const g = $('backup-group');
    if (g) g.classList.add('hidden');
  }
  if (api.__mobile) {
    const g = $('hotkey-group');
    if (g) g.classList.add('hidden');
  }
}

// ---------- 启动 ----------
let settings = { darkMode: false, newTaskHotkey: 'Ctrl+N' };

(async function boot() {
  // 等待数据层就绪（db.js + store.js + api.js）
  const start = Date.now();
  while (!window.AppAPI && !window.AppAPIError) {
    if (Date.now() - start >= 15000) {
      showError('数据层初始化失败');
      return;
    }
    await new Promise(function (r) { setTimeout(r, 100); });
  }
  if (window.AppAPIError) {
    showError('初始化失败: ' + window.AppAPIError);
    return;
  }
  api = window.AppAPI;
  hideDesktopOnlyGroups();
  switchView('active');
  await loadSettings();
  await loadTags();
  await refresh();
})();
