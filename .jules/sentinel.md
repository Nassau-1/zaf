## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-11 - Path Traversal bypass via String Prefix Matching
**Vulnerability:** Static file server path validation `filePath.startsWith(STATIC_DIR)` bypassed via adjacent paths (e.g., `/app/dashboard-secret.txt` starts with `/app/dashboard`). Also missing URI decoding and poison null byte check.
**Learning:** Using `String.prototype.startsWith()` on file paths without trailing separators enables directory traversal to sibling files/directories with matching prefixes.
**Prevention:** Always decode paths, check for poison null bytes, and append `path.sep` to the target directory (e.g., `filePath.startsWith(STATIC_DIR + path.sep)`) and explicitly allow exact directory matches if necessary.
