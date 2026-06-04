## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-04 - Modal Close Button Accessibility
**Learning:** Found that custom modal close buttons (`.zaf-launch-close`) lacked `aria-label` attributes and keyboard focus indicators, making them difficult to use for screen reader and keyboard users.
**Action:** Always verify that dynamically generated modal UI elements (like those in `app.js`) have appropriate `aria-label`s and `focus-visible` outlines.
