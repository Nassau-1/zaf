## 2024-06-01 - Cache Data JSON Endpoint
**Learning:** Frequent file I/O or synchronous shell executions on a highly trafficked GET endpoint creates massive bottlenecks. In dashboard/server.js, `/api/data` redundantly called `runParse` (which triggers file execution) on every read.
**Action:** When creating high-frequency GET endpoints that read file data, use an in-memory cache and a file watcher (like `chokidar`) to decouple I/O parsing from request fulfillment.
## 2024-06-23 - Optimize Repeated Sequence Extraction
**Learning:** Finding repeated event sequences using an O(N²) nested loop blocks the Node.js event loop on large process logs, causing API timeouts.
**Action:** Use a 2-pass O(N) algorithm with a Map to hash sequence signatures and count frequencies instead of repeatedly iterating through the array.
