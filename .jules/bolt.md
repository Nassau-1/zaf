## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.
## 2026-06-08 - Prevent UI lag by avoiding blocking event loop in VS Code extension
**Learning:** Synchronous file operations like `fs.readFileSync` and `fs.readdirSync` in the VS Code extension can cause UI lag and block the event loop, especially when iterating over files to provide gutter decorations and launch commands.
**Action:** Always replace synchronous file operations with asynchronous alternatives like `fs.promises` combined with `Promise.all()` for concurrent execution in extensions to keep the main thread responsive.
