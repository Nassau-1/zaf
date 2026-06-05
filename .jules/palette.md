## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.
## 2024-06-03 - Missing labels on dynamic modals
**Learning:** Dynamically generated modals (like `.zaf-launch-close` close buttons) often lack ARIA labels and focus states because they bypass static HTML analysis.
**Action:** When adding or auditing dynamic modal generation functions in vanilla JS (like in `app.js`), ensure accessibility attributes (`aria-label`) and corresponding focus states are included in the generated HTML and linked stylesheets.
