## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.

## 2024-10-24 - Async file operations for extension decorations
**Learning:** High-frequency VS Code listeners like `onDidChangeTextDocument` and command executions in the extension host can block the UI thread and event loop when executing synchronous file system reads (`fs.readFileSync`, `fs.readdirSync`).
**Action:** Replace synchronous operations with `fs.promises` and use `Promise.all()` for concurrent reading, especially for ticket directory exploration.
