// db.js — 数据库驱动适配器
// 安卓上走 @capacitor-community/sqlite 原生插件；测试环境可注入自定义驱动。
(function (root) {
  'use strict';

  var DB_NAME = 'todolist';

  async function openNativeDb() {
    var cap = root.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    var p = cap.Plugins && cap.Plugins.CapacitorSQLite;
    if (!p) return null;

    // 建立连接（无加密）
    await p.createConnection({
      database: DB_NAME,
      encrypted: false,
      mode: 'no-encryption',
      version: 1,
      readonly: false
    });
    await p.open({ database: DB_NAME });

    return {
      async exec(sql) {
        await p.execute({ database: DB_NAME, statements: sql, transaction: false });
      },
      async all(sql, params) {
        var r = await p.query({ database: DB_NAME, statement: sql, values: params || [] });
        return r.values || [];
      },
      async run(sql, params) {
        var r = await p.run({ database: DB_NAME, statement: sql, values: params || [] });
        var changes = (r && r.changes) || {};
        return { changes: changes.changes || 0, lastId: changes.lastId != null ? changes.lastId : null };
      }
    };
  }

  root.TodoDb = { openNativeDb: openNativeDb, DB_NAME: DB_NAME };
})(typeof window !== 'undefined' ? window : globalThis);
