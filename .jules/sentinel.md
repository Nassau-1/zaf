## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.
## 2024-06-23 - Improve Static File Serving Security
**Vulnerability:** Static file server permitted URI encoded directory navigation and null bytes, and used a loose prefix check for boundaries.
**Learning:** Using `filePath.startsWith(STATIC_DIR)` is insufficient because `/app-secret/file` starts with `/app`. Also, built-in URL parsers do not decode URI components before resolving paths.
**Prevention:** Always decode URI components, explicitly reject null bytes, and append `path.sep` to the base directory when performing prefix boundary checks.
