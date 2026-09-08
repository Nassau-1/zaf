## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-09-08 - Path Traversal Prevention
**Vulnerability:** HTTP endpoints accept user-supplied `repo` arguments that are passed to `path.resolve` or `path.join`, enabling directory traversal out of `REPOS_ROOT` allowing attackers to read/write arbitrary files.
**Learning:** `path.resolve` normalizes `..` segments and `path.join` on absolute roots does not prevent stepping back out of the root path.
**Prevention:** Validate resolved paths rigorously using `.startsWith()` against an explicit root boundary containing the path separator, and handle cases where it perfectly matches the root itself.
