
## 2024-06-01 - Prevent Command Injection with execFileSync
**Vulnerability:** Unsanitized user inputs (URLs, configurations) were concatenated into shell commands executed by `execSync` (e.g., `git clone "${url}"`), allowing command injection.
**Learning:** `execSync` uses a shell by default, which evaluates special characters (like `;`, `&`, `|`) leading to arbitrary command execution if the input is unsanitized.
**Prevention:** Use `execFileSync` instead, passing arguments as a discrete array. This circumvents the shell entirely, treating inputs purely as literal arguments to the executable.
