// store.js — 桌面版 Go 后端 (store.go) 的 JS 移植
// SQL 与桌面版完全一致，通过 db 适配器执行：
//   db.exec(sql)              执行无参数语句（建表等）
//   db.all(sql, params)  -> 行数组
//   db.run(sql, params)  -> { changes, lastId }
// 桌面与安卓共用同一套数据语义（导出 JSON 互通）。
(function (root) {
  'use strict';

  var SCHEMA = [
    'CREATE TABLE IF NOT EXISTS todos (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  title TEXT NOT NULL,',
    '  done INTEGER NOT NULL DEFAULT 0,',
    '  position INTEGER NOT NULL DEFAULT 0,',
    '  created_at INTEGER NOT NULL,',
    '  completed_at INTEGER,',
    '  due_at INTEGER,',
    '  urge_days INTEGER NOT NULL DEFAULT 3,',
    '  note TEXT,',
    "  tag TEXT NOT NULL DEFAULT ''",
    ');',
    'CREATE TABLE IF NOT EXISTS settings (',
    '  key TEXT PRIMARY KEY,',
    '  value TEXT NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS trash (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  title TEXT NOT NULL,',
    '  done INTEGER NOT NULL DEFAULT 0,',
    '  created_at INTEGER NOT NULL,',
    '  completed_at INTEGER,',
    '  due_at INTEGER,',
    '  urge_days INTEGER NOT NULL DEFAULT 3,',
    '  note TEXT,',
    "  tag TEXT NOT NULL DEFAULT '',",
    '  deleted_at INTEGER NOT NULL',
    ');'
  ].join('\n');

  var DAY = 86400;
  var DEFAULT_TAGS = [
    { name: '工作', color: '#4a90e2' },
    { name: '生活', color: '#3aa76d' }
  ];

  function now() { return Math.floor(Date.now() / 1000); }

  // ---- 行映射 ----
  function mapTodo(r) {
    return {
      id: r.id,
      title: r.title,
      done: r.done === 1 || r.done === true,
      position: r.position,
      created_at: r.created_at,
      completed_at: r.completed_at === undefined ? null : r.completed_at,
      due_at: r.due_at === undefined ? null : r.due_at,
      urge_days: r.urge_days,
      note: r.note === undefined || r.note === null ? '' : r.note,
      tag: r.tag === undefined || r.tag === null ? '' : r.tag,
      urge: false
    };
  }

  // ---- 督促判定与排序（移植自 store.go）----
  function isUrging(t, nowSec) {
    return t.due_at != null && (t.due_at - nowSec) <= t.urge_days * DAY;
  }

  function urgencyRank(t, nowSec) {
    if (t.due_at == null) return 2;        // 无截止时间
    return isUrging(t, nowSec) ? 0 : 1;    // 0=督促中 1=有截止但不紧迫
  }

  function cmpTodo(a, b, nowSec) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return 0; // 已完成保持原序（前端按年月分组）
    var ra = urgencyRank(a, nowSec), rb = urgencyRank(b, nowSec);
    if (ra !== rb) return ra - rb;
    if (ra === 2) {
      if (a.position !== b.position) return a.position - b.position;
      return a.id - b.id;
    }
    if (a.due_at !== b.due_at) return a.due_at - b.due_at;
    if (a.position !== b.position) return a.position - b.position;
    return a.id - b.id;
  }

  function createStore(db) {
    var api = {};

    async function init() {
      await db.exec(SCHEMA);
    }

    async function maxPosition() {
      var rows = await db.all('SELECT MAX(position) AS m FROM todos', []);
      return rows.length && rows[0].m != null ? rows[0].m : 0;
    }

    async function getTodo(id) {
      var rows = await db.all(
        'SELECT id, title, done, position, created_at, completed_at, due_at, urge_days, note, tag FROM todos WHERE id = ?', [id]);
      if (rows.length === 0) throw new Error('todo not found');
      return mapTodo(rows[0]);
    }

    async function getTodos() {
      var rows = await db.all(
        'SELECT id, title, done, position, created_at, completed_at, due_at, urge_days, note, tag FROM todos ORDER BY done ASC, position ASC, id ASC', []);
      var todos = rows.map(mapTodo);
      var nowSec = now();
      for (var i = 0; i < todos.length; i++) todos[i].urge = isUrging(todos[i], nowSec);
      todos.sort(function (a, b) { return cmpTodo(a, b, nowSec); });
      return todos;
    }

    api.addTodo = async function (title, dueAt, urgeDays, note, tag) {
      if (urgeDays < 0) urgeDays = 0;
      var pos = await maxPosition();
      var r = await db.run(
        'INSERT INTO todos (title, done, position, created_at, due_at, urge_days, note, tag) VALUES (?, 0, ?, ?, ?, ?, ?, ?)',
        [title, pos + 1, now(), dueAt, urgeDays, note, tag]);
      return getTodo(r.lastId);
    };

    api.updateTodo = async function (id, title, dueAt, urgeDays, note, tag) {
      if (urgeDays < 0) urgeDays = 0;
      await db.run(
        'UPDATE todos SET title = ?, due_at = ?, urge_days = ?, note = ?, tag = ? WHERE id = ?',
        [title, dueAt, urgeDays, note, tag, id]);
      return getTodo(id);
    };

    api.getTodos = getTodos;

    api.toggleTodo = async function (id) {
      var t = await getTodo(id);
      var pos = await maxPosition();
      if (!t.done) {
        await db.run('UPDATE todos SET done = 1, position = ?, completed_at = ? WHERE id = ?',
          [pos + 1, now(), id]);
      } else {
        await db.run('UPDATE todos SET done = 0, position = ?, completed_at = NULL WHERE id = ?',
          [pos + 1, id]);
      }
      return getTodo(id);
    };

    // 删除 → 移入回收站（保留最近 30 条）
    api.deleteTodo = async function (id) {
      await db.run('BEGIN', []);
      try {
        await db.run(
          'INSERT INTO trash (title, done, created_at, completed_at, due_at, urge_days, note, tag, deleted_at) ' +
          'SELECT title, done, created_at, completed_at, due_at, urge_days, note, tag, ? FROM todos WHERE id = ?',
          [now(), id]);
        await db.run('DELETE FROM todos WHERE id = ?', [id]);
        await db.run(
          'DELETE FROM trash WHERE id NOT IN (SELECT id FROM trash ORDER BY deleted_at DESC, id DESC LIMIT 30)', []);
        await db.run('COMMIT', []);
      } catch (err) {
        try { await db.run('ROLLBACK', []); } catch (e) { /* ignore */ }
        throw err;
      }
    };

    // ---- 回收站 ----
    api.getTrash = async function () {
      var rows = await db.all(
        'SELECT id, title, done, created_at, completed_at, due_at, urge_days, note, tag, deleted_at FROM trash ORDER BY deleted_at DESC, id DESC', []);
      return rows.map(function (r) {
        var t = mapTodo(r);
        return {
          id: r.id, title: t.title, done: t.done, created_at: t.created_at,
          completed_at: t.completed_at, due_at: t.due_at, urge_days: t.urge_days,
          note: t.note, tag: t.tag, deleted_at: r.deleted_at
        };
      });
    };

    api.restoreTodo = async function (id) {
      await db.run('BEGIN', []);
      try {
        var rows = await db.all(
          'SELECT title, done, created_at, completed_at, due_at, urge_days, note, tag FROM trash WHERE id = ?', [id]);
        if (rows.length === 0) throw new Error('trash item not found');
        var it = mapTodo(rows[0]);
        var pos = await maxPosition();
        var r = await db.run(
          'INSERT INTO todos (title, done, position, created_at, completed_at, due_at, urge_days, note, tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [it.title, it.done ? 1 : 0, pos + 1, it.created_at, it.completed_at, it.due_at, it.urge_days, it.note, it.tag]);
        await db.run('DELETE FROM trash WHERE id = ?', [id]);
        await db.run('COMMIT', []);
        return r.lastId;
      } catch (err) {
        try { await db.run('ROLLBACK', []); } catch (e) { /* ignore */ }
        throw err;
      }
    };

    api.purgeTrash = async function (id) {
      await db.run('DELETE FROM trash WHERE id = ?', [id]);
    };

    api.clearTrash = async function () {
      await db.run('DELETE FROM trash', []);
    };

    // ---- 设置 ----
    api.getSettings = async function () {
      var out = { dark_mode: false, new_task_hotkey: 'Ctrl+N' };
      var rows = await db.all('SELECT key, value FROM settings', []);
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].key === 'dark_mode') out.dark_mode = rows[i].value === '1';
        else if (rows[i].key === 'new_task_hotkey' && rows[i].value) out.new_task_hotkey = rows[i].value;
      }
      return out;
    };

    api.saveSettings = async function (darkMode, newTaskHotkey) {
      var dark = darkMode ? '1' : '0';
      if (!newTaskHotkey) newTaskHotkey = 'Ctrl+N';
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['dark_mode', dark]);
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['new_task_hotkey', newTaskHotkey]);
    };

    // ---- 标签 ----
    api.getTags = async function () {
      var rows = await db.all('SELECT value FROM settings WHERE key = ?', ['tags']);
      if (rows.length === 0) return DEFAULT_TAGS.slice();
      try {
        var defs = JSON.parse(rows[0].value);
        return Array.isArray(defs) ? defs : [];
      } catch (e) {
        return DEFAULT_TAGS.slice();
      }
    };

    api.saveTags = async function (defs) {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['tags', JSON.stringify(defs)]);
    };

    api.deleteTag = async function (name) {
      var defs = (await api.getTags()).filter(function (d) { return d.name !== name; });
      await api.saveTags(defs);
      await db.run("UPDATE todos SET tag = '' WHERE tag = ?", [name]);
    };

    api.init = init;
    return api;
  }

  root.TodoStore = { createStore: createStore, SCHEMA: SCHEMA };
  if (typeof module === 'object' && module.exports) {
    module.exports = root.TodoStore;
  }
})(typeof window !== 'undefined' ? window : globalThis);
