
## 2025-02-18 - Prevent Command Injection via execSync
**Vulnerability:** Arbitrary command injection possible via unsanitized URLs passed to `child_process.execSync` in string interpolation for git commands (e.g., `git clone`).
**Learning:** Using string interpolation with `execSync` is inherently unsafe as it spawns a shell that can interpret shell metacharacters embedded within variables.
**Prevention:** Use `child_process.execFileSync` with the executable as the first argument and an array of arguments as the second. This bypasses the shell entirely, ensuring input is treated as literal arguments.
