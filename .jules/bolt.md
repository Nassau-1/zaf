## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.

## 2024-06-03 - Avoid Sync File Operations in Event Loop
**Learning:** In the VS Code extension (`extension/extension.js`), using synchronous file operations (like `fs.readFileSync` and `fs.readdirSync`) blocks the Node.js event loop and can cause significant UI lag, especially when doing iterative file reading or reading many files inside commands like `zaf.launchAgent` or `updateDecorations`.
**Action:** Replace synchronous file operations with asynchronous alternatives like `fs.promises` combined with `Promise.all()` for concurrent execution to prevent UI lag and blocking the event loop.
