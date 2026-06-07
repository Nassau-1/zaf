## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.
## 2024-06-08 - Dynamic Modal Close Buttons Lack Accessibility Attributes
**Learning:** Dynamically generated UI components in vanilla JS (like modals in app.js) bypass static HTML a11y analysis. Their close buttons were missing `aria-label`s and CSS `:focus-visible` states.
**Action:** Always explicitly include `aria-label` and `title` on dynamically generated icon-only buttons, and ensure their classes are mapped to existing `:focus-visible` styles for keyboard navigation.
