## 2024-05-24 - Async Skill Directory Reads
**Learning:** In HTTP request handlers like the one in `dashboard/server.js`, using synchronous file system operations (like `fs.readFileSync` inside a loop and `fs.readdirSync`) blocks the event loop and severely degrades performance under concurrent load.
**Action:** Replace synchronous iterations with `Promise.all` and map the values to `fs.promises.readFile` to process files concurrently and yield to the event loop. Replace synchronous directory reads with `await fs.promises.readdir`.
