## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-06-12 - Form Label Accessibility in Dynamic Templates
**Learning:** Found a systemic pattern where template-literal driven HTML components consistently missed the 'for' attribute on labels, hindering screen reader use.
**Action:** When building forms programmatically via string templates, always ensure explicit label-to-input association is maintained through 'for' or 'htmlFor'.
