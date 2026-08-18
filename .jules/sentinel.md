## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.
## 2026-08-17 - Path Traversal via path.resolve() in Express Routes
**Vulnerability:** Arbitrary path traversal due to unsanitized user inputs (`repoSlug`, `repoName`) being passed directly to `path.resolve(REPOS_ROOT, userInput)`.
**Learning:** In Node.js, `path.resolve(basePath, userInput)` evaluates `..` segments, potentially traversing outside the intended base directory.
**Prevention:** Use a safe resolver function that explicitly validates the resolved path string begins with the intended root directory, utilizing `.startsWith(baseDir + path.sep)`.
