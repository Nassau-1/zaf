## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.
## 2024-06-17 - Missing ARIA Labels on Icon Buttons\n**Learning:** The 'X' close buttons in the modal flyouts (`.zaf-launch-close`) lack explicit ARIA labels and focus-visible outlines, making them inaccessible to screen readers and difficult to navigate via keyboard.\n**Action:** Added `aria-label="Close"` to all modal close buttons and defined `.zaf-launch-close:focus-visible` in the CSS to ensure proper keyboard accessibility indicators.
## 2024-06-17 - Missing ARIA Labels on Icon Buttons
**Learning:** The 'X' close buttons in the modal flyouts (`.zaf-launch-close`) lack explicit ARIA labels and focus-visible outlines, making them inaccessible to screen readers and difficult to navigate via keyboard.
**Action:** Added `aria-label="Close"` to all modal close buttons and defined `.zaf-launch-close:focus-visible` in the CSS to ensure proper keyboard accessibility indicators.
