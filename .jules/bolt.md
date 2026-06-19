## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.
## 2024-06-19 - VS Code Extension Sync File I/O Blocking Event Loop
**Learning:** Using synchronous `fs.readdirSync` and `fs.readFileSync` inside high-frequency VS Code event listeners (like `onDidChangeTextDocument` which fires on every keystroke) blocks the extension host's main thread and causes severe UI lag.
**Action:** Replace synchronous file operations with asynchronous alternatives (`fs.promises.readdir`, `fs.promises.readFile`) combined with `Promise.all()` for concurrent execution when processing multiple ticket files.
