// store.test.mjs — 用 node:sqlite 驱动跑 store.js，验证与桌面版一致的逻辑
import { DatabaseSync } from 'node:sqlite';
import TodoStore from '../www/store.js';
const { createStore } = TodoStore;

const DAY = 86400;
const nowSec = Math.floor(Date.now() / 1000);
let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
}

function makeDriver(db) {
  return {
    async exec(sql) { db.exec(sql); },
    async all(sql, params = []) { return db.prepare(sql).all(...params); },
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: r.changes, lastId: Number(r.lastInsertRowid) };
    }
  };
}

const db = new DatabaseSync(':memory:');
const store = createStore(makeDriver(db));
await store.init();
console.log('== 初始化 ==');
check('schema 建表成功', true);

console.log('== 紧迫度排序与督促标记 ==');
// A: 明天截止(督促中)  A2: 后天截止(督促中)  D: 5天后但督促窗口7天(督促中)
// B: 15天后(不紧迫)  C: 无截止(垫底)
const a = await store.addTodo('A 明天截止', nowSec + 1 * DAY, 3, '备注A', '工作');
const a2 = await store.addTodo('A2 后天截止', nowSec + 2 * DAY, 3, '', '工作');
const b = await store.addTodo('B 半月后截止', nowSec + 15 * DAY, 3, '', '生活');
const c = await store.addTodo('C 无截止时间', null, 3, '', '');
const d = await store.addTodo('D 五天后截止但督促7天', nowSec + 5 * DAY, 7, '', '');

let todos = await store.getTodos();
check('排序 A→A2→D→B→C',
  todos.map(t => t.id).join() === [a.id, a2.id, d.id, b.id, c.id].join(),
  todos.map(t => t.title));
check('A/A2/D 标记督促', todos.filter(t => t.urge).map(t => t.id).join() === [a.id, a2.id, d.id].join());
check('B/C 不督促', todos.filter(t => !t.urge).map(t => t.id).join() === [b.id, c.id].join());
check('A 备注回读', todos.find(t => t.id === a.id).note === '备注A');
check('A 标签回读', todos.find(t => t.id === a.id).tag === '工作');
check('C 无截止不督促', todos.find(t => t.id === c.id).due_at === null);

console.log('== 完成/恢复 ==');
const tc = await store.toggleTodo(c.id);
check('完成 → completed_at 写入', tc.done === true && tc.completed_at !== null);
todos = await store.getTodos();
check('已完成排在最后', todos[todos.length - 1].id === c.id);
const back = await store.toggleTodo(c.id);
check('恢复未完成 → completed_at 清空', back.done === false && back.completed_at === null);

console.log('== 编辑 ==');
await store.updateTodo(b.id, 'B 改过的标题', nowSec + 3 * DAY, 7, '新备注', '生活');
todos = await store.getTodos();
const bb = todos.find(t => t.id === b.id);
check('编辑后标题/备注生效', bb.title === 'B 改过的标题' && bb.note === '新备注');
check('编辑后督促窗口变化(3天内→督促中)', bb.urge === true);
check('编辑后排序提前(督促区)', todos[2].id === b.id, todos.map(t => t.title));

console.log('== 回收站 ==');
await store.deleteTodo(a.id);
todos = await store.getTodos();
check('删除后从列表消失', !todos.some(t => t.id === a.id));
let trash = await store.getTrash();
check('回收站有一条', trash.length === 1 && trash[0].title === 'A 明天截止');
check('回收站保留备注标签', trash[0].note === '备注A' && trash[0].tag === '工作');
const restoredId = await store.restoreTodo(trash[0].id);
todos = await store.getTodos();
check('恢复回列表(带原备注标签)', todos.some(t => t.id === restoredId && t.note === '备注A' && t.tag === '工作'));
trash = await store.getTrash();
check('恢复后回收站清空该条', trash.length === 0);

// 30 条上限：连删 35 条，只留最近 30 条
for (let i = 0; i < 35; i++) {
  const t = await store.addTodo('批量删除 ' + i, null, 3, '', '');
  await store.deleteTodo(t.id);
}
trash = await store.getTrash();
check('回收站只保留最近 30 条', trash.length === 30, trash.length);
check('保留的是最近的(不含第1条)', !trash.some(t => t.title === '批量删除 0'));
const trashCountBefore = (await store.getTrash()).length;
await store.purgeTrash(trash[0].id);
check('彻底删除单条', (await store.getTrash()).length === trashCountBefore - 1);
await store.clearTrash();
check('清空回收站', (await store.getTrash()).length === 0);

console.log('== 设置 ==');
await store.saveSettings(true, 'Alt+Q');
let s = await store.getSettings();
check('深色模式持久化', s.dark_mode === true);
check('快捷键持久化', s.new_task_hotkey === 'Alt+Q');
s = await store.getSettings();
check('缺省快捷键 Ctrl+N', s.new_task_hotkey === 'Ctrl+N' || s.new_task_hotkey === 'Alt+Q');

console.log('== 标签 ==');
let defs = await store.getTags();
check('默认标签 工作/生活', defs.length === 2 && defs[0].name === '工作' && defs[1].name === '生活');
defs.push({ name: '学习', color: '#e8a33d' });
await store.saveTags(defs);
defs = await store.getTags();
check('自定义标签保存', defs.length === 3 && defs[2].name === '学习');
await store.deleteTag('工作');
defs = await store.getTags();
check('删除标签', defs.length === 2 && !defs.some(d => d.name === '工作'));
todos = await store.getTodos();
check('任务上的被删标签同时清除', todos.every(t => t.tag !== '工作'));

console.log('');
console.log('结果: ' + passed + ' 通过, ' + failed + ' 失败');
process.exit(failed > 0 ? 1 : 0);
