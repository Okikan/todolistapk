# 待办清单 Android 版

基于 **Capacitor 7** 的安卓版待办清单。核心逻辑由桌面版 Go 后端（store.go）移植为
JavaScript（`www/store.js`），SQL 与桌面版完全一致，数据语义互通。

## 文件结构

```
todolistapk/
├─ capacitor.config.json   Capacitor 配置（appId: com.kanji.todolist）
├─ package.json            依赖：@capacitor/core/android/cli + @capacitor-community/sqlite
├─ www/                    前端（与桌面版同源，触屏适配）
│  ├─ index.html           页面结构（与桌面版差异：新增脚本引入、分组 id）
│  ├─ styles.css           样式（与桌面版同源）
│  ├─ mobile.css           移动端适配（窄屏顶部导航、触控优化）
│  ├─ db.js                SQLite 驱动适配器（CapacitorSQLite 原生插件）
│  ├─ store.js             Go 后端移植（排序/督促/回收站/标签/设置）
│  ├─ api.js               组装并暴露 window.AppAPI（与桌面绑定同名）
│  └─ main.js              界面逻辑（与桌面版差异：长按菜单、隐藏桌面专属设置）
├─ test/store.test.mjs     用 node:sqlite 跑 store.js 的逻辑测试（29 项全过）
└─ android/                Capacitor 生成的安卓工程
```

## 构建环境

- JDK 21（已装：C:\Program Files\Java\jdk-21.0.10）
- Android SDK：C:\Users\kanji\android-sdk（licenses 已写入，缺的组件由 AGP 自动下载）
- Gradle 8.11.1（wrapper 已指向腾讯镜像）

## 常用命令

```powershell
# 修改 www/ 后同步到安卓工程
npx cap sync android

# 编译 debug APK
cd android
$env:JAVA_HOME='C:\Program Files\Java\jdk-21.0.10'
$env:ANDROID_SDK_ROOT='C:\Users\kanji\android-sdk'
.\gradlew.bat assembleDebug
# 产物: android\app\build\outputs\apk\debug\app-debug.apk
```

## 与桌面版的差异

- 触屏长按任务 = 桌面右键菜单；窄屏自动切换为顶部导航布局
- 设置页隐藏了桌面专属项：应用内快捷键、数据备份（文件对话框）、开机自启
- 数据存储在应用私有目录的 SQLite（capacitor-sqlite），卸载应用会清空；
  桌面版"导出 JSON"文件将来可通过导入功能互通（安卓端导入待接入文件选择器）
