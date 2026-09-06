// api.js — 组装数据层并暴露与桌面版同名的 AppAPI
// main.js 与桌面版保持一致，只认 window.AppAPI。
(function (root) {
  'use strict';

  root.AppAPIReady = (async function () {
    try {
      var db = await root.TodoDb.openNativeDb();
      if (!db) throw new Error('SQLite 插件不可用（仅在安卓 App 内运行）');
      var store = root.TodoStore.createStore(db);
      await store.init();
      root.AppAPI = {
        __mobile: true,
        GetTodos: function () { return store.getTodos(); },
        AddTodo: function (title, dueAt, urgeDays, note, tag) { return store.addTodo(title, dueAt, urgeDays, note, tag); },
        UpdateTodo: function (id, title, dueAt, urgeDays, note, tag) { return store.updateTodo(id, title, dueAt, urgeDays, note, tag); },
        ToggleTodo: function (id) { return store.toggleTodo(id); },
        DeleteTodo: function (id) { return store.deleteTodo(id); },
        GetTrash: function () { return store.getTrash(); },
        RestoreTodo: function (id) { return store.restoreTodo(id); },
        PurgeTrash: function (id) { return store.purgeTrash(id); },
        ClearTrash: function () { return store.clearTrash(); },
        GetSettings: function () { return store.getSettings(); },
        SaveSettings: function (darkMode, hotkey) { return store.saveSettings(darkMode, hotkey); },
        GetTags: function () { return store.getTags(); },
        SaveTags: function (tags) { return store.saveTags(tags); },
        DeleteTag: function (name) { return store.deleteTag(name); }
      };
    } catch (err) {
      root.AppAPIError = err && err.message ? err.message : String(err);
      throw err;
    }
  })();
})(typeof window !== 'undefined' ? window : globalThis);
