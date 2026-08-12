## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.
## 2024-06-25 - Prevent event loop blocking on large log arrays
**Learning:** O(N²) nested iterations for string manipulations or subsequence matching on large process log arrays block the Node.js event loop and cause API timeouts.
**Action:** Use an O(N) approach with `Map` for frequency counting and caching signatures to decouple parsing from request fulfillment.
## 2024-06-21 - Asynchronous File I/O in Extension Event Loop
**Learning:** Synchronous file operations (`fs.readdirSync`, `fs.readFileSync`) in VS Code extension handlers tied to frequent events (like `onDidChangeTextDocument`) block the main thread, causing severe UI lag.
**Action:** Always replace synchronous I/O with asynchronous alternatives (`fs.promises`) and use `Promise.all()` to process multiple files concurrently when extracting decorations or similar data across a directory.

## 2024-06-02 - Async I/O for HTTP endpoints
**Learning:** Using sequential synchronous I/O operations (like `fs.readdirSync` combined with `fs.readFileSync` inside `.map()`) in HTTP request handlers blocks the Node.js event loop, creating a bottleneck for concurrent requests.
**Action:** Replace synchronous file system operations with `fs.promises` and utilize `Promise.all()` to process multiple files concurrently in server endpoints, like `/api/repo/skills`.
## 2024-07-28 - Cache Audit Log Array
**Learning:** `fs.readFileSync` combined with string split, `.map()`, and `JSON.parse` on every request for `audit-log.jsonl` severely blocks the event loop on frequent reads, since it's an O(N) operation on a growing file.
**Action:** Use an in-memory cache variable to hold the parsed array, pushing to it during appends (`auditAppend`), and only reading from disk when the cache is missing.
