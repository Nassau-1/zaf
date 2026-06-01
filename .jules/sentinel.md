## 2025-06-01 - Command Injection in git remote add
**Vulnerability:** Unsanitized user input (`remoteUrl`) passed to `execSync` inside string interpolation allowing shell command injection when creating a repo.
**Learning:** `execSync` executing commands as a shell interpolates variables natively, bypassing Node.js argument processing and executing arbitrary input.
**Prevention:** Use `execFileSync` passing an array of arguments, preventing execution of injected shell commands.
