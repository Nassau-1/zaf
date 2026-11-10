## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.
## 2025-03-01 - [CRITICAL] Command Injection in CLI Status Check
**Vulnerability:** Command Injection. The `dashboard/server.js` endpoint `/api/cli/status` executes `execSync(versionCmd, { shell: true })` where `versionCmd` is derived from external JSON payload configs or queries.
**Learning:** Using `shell: true` with any dynamically sourced config without sanitization exposes the system to Arbitrary Command Execution via operators like `&&` or `;`.
**Prevention:** Avoid `shell: true` with `execSync` or `exec`. Instead, parse the shell arguments safely using libraries like `shell-quote` (e.g. `parseShellQuote(versionCmd).filter(a => typeof a === 'string')`) and execute securely using `execFileSync` with `shell: false`.
