## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.

## 2024-06-02 - VS Code Extension Event Loop Blocking
**Learning:** In the VS Code extension (`extension/extension.js`), using synchronous file operations (like `fs.readFileSync` and `fs.readdirSync`) inside high-frequency event listeners (such as `onDidChangeTextDocument` or `onDidChangeActiveTextEditor`) blocks the Node.js event loop. This blocks the main thread and causes noticeable UI lag for users on every keystroke.
**Action:** Replace synchronous file operations with asynchronous alternatives like `fs.promises` combined with `Promise.all()` for concurrent execution to prevent UI lag and maintain a responsive extension experience.
