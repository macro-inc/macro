// Organized imports alphabetically
import Article from '@icon/regular/article-medium.svg';
import CheckList from '@icon/regular/list-checks.svg';
import Microscope from '@icon/regular/microscope.svg';
import NoteBook from '@icon/regular/notebook.svg';
import NotePad from '@icon/regular/notepad.svg';
import Chart from '@icon/regular/projector-screen-chart.svg';
import type { Component, JSX } from 'solid-js';

export type Template = {
  id: string;
  name: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  subtext: string;
  title: string;
  content: string;
};

export const TEMPLATES: Template[] = [
  {
    id: 'todo',
    name: 'To-Do List',
    icon: CheckList,
    subtext: 'Track and prioritize tasks to boost your productivity',
    title: 'To-Do List: [DATE]',
    content: `
## 🔥 Important
- [ ] **Task name**
  🗓 Due: MM/DD/YYY
  📌 Notes: Brief detail or link

- [ ] **Another task**
  🗓 Due:
  📌 Notes:
\n\n \n
---
\n\n \n
## ⚡ Today - [DATE]
- [ ] **Task name**
  🗓 Due:
  📌 Notes:

- [ ] **Another task**
  🗓 Due:
  📌 Notes:
\n\n \n
---
\n\n \n
## 🗄 Upcoming
- [ ] **Task name**
  🗓 Due:
  📌 Notes:

- [ ] **Task name**
  🗓 Due:
  📌 Notes:
`,
  },
  {
    id: 'blog_post',
    name: 'Blog Post',
    icon: Article,
    subtext: 'Craft compelling stories that captivate and inform your audience',
    title: 'Blog Post: [Title]',
    content: `
**Date:** [DATE]
**Author:** [USER]
**Tags:** [tag1], [tag2], [tag3]
\n\n \n
## Introduction
A compelling introduction to your topic that hooks the reader and gives a brief overview of what they'll learn.
This article will help you understand [main benefit] by exploring [topic overview].
\n\n \n
## [Section 1 Heading]
Main content for section 1. Include relevant information, examples, and insights. 
\n\n \n
### [Subsection 1.1]
More detailed exploration of a specific aspect of section 1.
[Insert Image]
\n\n \n
## [Section 2 Heading]
Main content for section 2. Continue providing value to the reader.
> "A relevant quote that adds credibility or emphasis to your content." - Quote Author
**Example:** [Describe a real-world example that illustrates your point]
\n\n \n
## [Section 3 Heading]
Main content for section 3. Consider adding:
- Bullet points for easier reading
- Important takeaways
- Tips and tricks
- Common misconceptions
- Step-by-step instructions
\n\n \n
## Conclusion
Summarize the main points of your post and provide a call to action or final thoughts.
What will you try first? Share your experience in the comments below!
\n\n \n
---
\n\n \n
**Further Reading:**
- Related Link 1
\n\n \n
**Share this post:**
[Twitter] [Facebook] [LinkedIn] [Reddit]
`,
  },
  {
    id: 'meeting_notes',
    name: 'Meeting Notes',
    icon: NotePad,
    subtext:
      'Document discussions, decisions, and follow-up actions efficiently',
    title: 'Meeting Notes: [DATE]',
    content: `**Date:** [DATE]
**Time:** [HH:MM] - [HH:MM] [Timezone]
**Location:** [Physical Location/Virtual Platform]  
**Meeting Link:** [URL for recording/virtual meeting]
**Attendees:** 
- [USER], [Role/Department]
- @attendee2, [Role/Department]
- @attendee3, [Role/Department]
\n\n \n
## Agenda
1. [Agenda item 1] (XX min)
2. [Agenda item 2] (XX min)
3. [Agenda item 3] (XX min)
\n\n \n
## Discussion Points
### [Topic 1]
- Key point 1
- Key point 2
- Questions/concerns raised
- Supporting data presented: [brief summary]
\n\n \n
### [Topic 2]
- Key point 1
- Key point 2
- Questions/concerns raised
\n\n \n
## Decisions Made
1. [Decision 1] - Rationale: [Brief explanation]
2. [Decision 2] - Rationale: [Brief explanation]
\n\n \n
## Action Items
- [ ] [Action item 1] - Assigned to: [Name] - Due: [MM/DD/YYYY]
- [ ] [Action item 2] - Assigned to: [Name] - Due: [MM/DD/YYYY]
- [ ] [Action item 3] - Assigned to: [Name] - Due: [MM/DD/YYYY]
\n\n \n
## Unresolved Issues
1. [Issue 1] - Owner: [Name] - Follow-up plan: [Brief description]
2. [Issue 2] - Owner: [Name] - Follow-up plan: [Brief description]
\n\n \n
## Resources Shared
1. [Resource 1]: [URL or location]
2. [Resource 2]: [URL or location]
\n\n \n
---
\n\n \n
## Next Meeting
**Date:** [MM/DD/YYYY]
**Time:** [HH:MM] [Timezone]
**Location:** [Physical Location/Virtual Platform]
**Preliminary Agenda:**
1. [Agenda item 1]
2. [Agenda item 2]
3. Follow up on action items from current meeting
`,
  },
  {
    id: 'project_management',
    name: 'Project Management',
    icon: Chart,
    subtext: 'Organize your project with goals, timelines, and resources',
    title: 'Project Plan: [Project Name]',
    content: `
## Project Overview
**Start Date:** [DATE]
**End Date:** [End Date]
**Project Manager:** [USER]
**Department:** [Department Name]
\n\n \n
### Project Description
[Brief description of what the project aims to accomplish]
\n\n \n
### Project Goals
1. [Goal 1]
2. [Goal 2]
3. [Goal 3]
\n\n \n
### Success Metrics
- [Metric 1]: [Target]
- [Metric 2]: [Target]
- [Metric 3]: [Target]
\n\n \n
## Project Scope
### In Scope
- [In Scope Item 1]
- [In Scope Item 2]
- [In Scope Item 3]
\n\n \n
### Out of Scope
- [Out of Scope Item 1]
- [Out of Scope Item 2]
- [Out of Scope Item 3]
\n\n \n
## Team & Stakeholders
### Core Team
- @member1, [Role] - Responsibilities: [Responsibilities]
- @member2, [Role] - Responsibilities: [Responsibilities]
- @member3, [Role] - Responsibilities: [Responsibilities]
\n\n \n
### Key Stakeholders
- @stakeholder1, [Position] - Interest: [Interest in Project]
- @stakeholder2, [Position] - Interest: [Interest in Project]
- @stakeholder3, [Position] - Interest: [Interest in Project]
\n\n \n
## Timeline & Milestones
### Phase 1: [Phase Name]
**Duration:** [Duration]
**Dates:** [Start Date] - [End Date]
**Milestone:** [Milestone Description]
**Key Tasks:**
\t - [ ] [Task 1] - Assigned to: @assignee1 - Due: [Due Date]
\t - [ ] [Task 2] - Assigned to: @assignee2 - Due: [Due Date]
\t - [ ] [Task 3] - Assigned to: @assignee3 - Due: [Due Date]
\n\n \n
### Phase 2: [Phase Name]
**Duration:** [Duration]
**Dates:** [Start Date] - [End Date]
**Milestone:** [Milestone Description]
**Key Tasks:**
\t - [ ] [Task 1] - Assigned to: @assignee1 - Due: [Due Date]
\t - [ ] [Task 2] - Assigned to: @assignee2 - Due: [Due Date]
\t - [ ] [Task 3] - Assigned to: @assignee3 - Due: [Due Date]
\n\n \n
### Phase 3: [Phase Name]
**Duration:** [Duration]
**Dates:** [Start Date] - [End Date]
**Milestone:** [Milestone Description]
**Key Tasks:**
\t - [ ] [Task 1] - Assigned to: @assignee1 - Due: [Due Date]
\t - [ ] [Task 2] - Assigned to: @assignee2 - Due: [Due Date]
\t - [ ] [Task 3] - Assigned to: @assignee3 - Due: [Due Date]
\n\n \n
## Resources & Budget
### Required Resources
- **Equipment:** [Equipment Requirements]
- **Software:** [Software Requirements]
- **Other:** [Other Requirements]
\n\n \n
### Budget Breakdown
| Category | Description | Estimated Cost |
|----------|-------------|----------------|
| Equipment | [Description] | $[Amount] |
| Software | [Description] | $[Amount] |
| Other | [Description] | $[Amount] |
| **Total** | | **$[Total Amount]** |
\n\n \n
## Risk Management
### Identified Risks
| Risk | Likelihood (1-5) | Impact (1-5) | Score | Mitigation Strategy |
|------|------------------|--------------|-------|---------------------|
| [Risk Description] | [Rating] | [Rating] | [Score] | [Mitigation Plan] |
| [Risk Description] | [Rating] | [Rating] | [Score] | [Mitigation Plan] |
| [Risk Description] | [Rating] | [Rating] | [Score] | [Mitigation Plan] |
\n\n \n
## Dependencies
- [Dependency 1]: [Impact Description]
- [Dependency 2]: [Impact Description]
- [Dependency 3]: [Impact Description]
\n\n \n
## Communication Plan
### Regular Updates
- **Team Meetings:** [Schedule]
- **Status Reports:** [Schedule and Method]
- **Stakeholder Updates:** [Schedule and Method]
\n\n \n
### Escalation Path
1. [First Contact]
2. [Second Contact]
3. [Final Contact]
\n\n \n
## Approval
**Approved By:** @approver
**Date:** [Approval Date]
\n\n \n
## Revision History
| Version | Date | Description of Changes | Changed By |
|---------|------|------------------------|------------|
| 1.0 | [DATE] | Initial plan | [USER] |
| [Version Number] | [Date] | [Change Description] | [Editor Name] |
`,
  },
  {
    id: 'research_paper',
    name: 'Research Paper',
    icon: Microscope,
    subtext: 'Structure your findings with academic precision and clarity',
    title: 'Research Paper: [Title]',
    content: `
## Abstract
This research explores [topic] by [methodology]. The study found [brief summary of key findings], suggesting [brief implications]. These results contribute to [field or domain] by [significance].
\n\n \n
## Summary
A brief 2-3 sentence summary of the paper's main contribution and findings.
\n\n \n
## Key Points
- Key point 1
- Key point 2
- Key point 3
\n\n \n
## Research Questions
1. [Research question 1]
2. [Research question 2]
\n\n \n
## Methodology
- **Design:** [Experimental design, survey, case study, etc.]
- **Participants:** [Number and characteristics of participants]
- **Materials:** [Key instruments or materials used]
- **Procedure:** [Brief description of the procedure]
- **Data Analysis:** [Approaches used to analyze collected data]
\n\n \n
## Results
- Finding 1
- Finding 2
- Finding 3
\n\n \n
### Data Visualization
[Insert chart/graph/table description]
\n\n \n
## Discussion
- Interpretation of finding 1
- Interpretation of finding 2
- Comparison with previous research
\n\n \n
## Limitations
- Limitation 1
- Limitation 2
- Potential biases or confounding factors
\n\n \n
## Future Research
- Suggestion 1
- Suggestion 2
- Potential applications
\n\n \n
## Conclusion
- [Your thoughts on the paper's strengths]
- [Questions that emerged while reading]
- [How this connects to other research you've read]
- [Potential applications of this research]
\n\n \n
## Important Quotes
> "Direct quote from the paper that captures an essential point." (p. X)

> "Another significant quote worth remembering." (p. Y)
\n\n \n
## Acknowledgements
Opportunity to thank those who have helped and supported you personally and professionally during your thesis or dissertation process
\n\n \n
## References
[Author Last Name], [First Initial]. ([Year]). [Title of paper]. [Journal Name], [Volume / Issue], [Page range]. [DOI or URL]
\n\n \n
## Appendix
- [Data tables]
- [Additional methodology details]
- [Survey instruments]
`,
  },
  {
    id: 'documentation',
    name: 'Documentation',
    icon: NoteBook,
    subtext: 'Create clear guides and references for technical implementations',
    title: '[Component/Feature/API] Documentation',
    content: `
## Overview
A brief description of what this project does and who it's for. Keep it simple and clear, ideally 2-3 sentences that explain the core purpose.
\n\n \n
## Features
- **Feature 1**: Brief description of a key feature
- **Feature 2**: Brief description of another feature
- **Feature 3**: You get the idea...
\n\n \n
## Demo
[Insert Demo Image / Video]
\n\n \n
## Installation
\`\`\`bash
# Clone the repository
git clone https://github.com/username/project-name.git

# Navigate to the project directory
cd project-name

# Install dependencies
npm install

# Start the development server
npm start
\`\`\`
\n\n \n
## Usage
\`\`\`javascript
// Include a code example showing how to use your project
import { someFunction } from 'your-project';

// Example usage
const result = someFunction('example parameter');
console.log(result);
\`\`\`
\n\n \n
## API Reference
| Endpoint | Method | Description |
|----------|--------|-------------|
| \`/api/items\` | GET | Retrieves all items |
| \`/api/items/:id\` | GET | Retrieves a specific item by ID |
| \`/api/items\` | POST | Creates a new item |
| \`/api/items/:id\` | PUT | Updates an existing item |
| \`/api/items/:id\` | DELETE | Deletes an item |
\n\n \n
## Tech Stack
- [React](https://reactjs.org/) - Frontend framework
- [Node.js](https://nodejs.org/) - Backend runtime
- [Express](https://expressjs.com/) - Server framework
- [MongoDB](https://mongodb.com/) - Database
\n\n \n
## Roadmap
- [ ] Feature A - Coming Q4 2025
- [ ] Feature B - Coming Q2 2026
- [ ] Mobile application - Coming Q3 2026
\n\n \n
## Contributing
Contributions are always welcome!
1. Fork the project
2. Create your feature branch (\`git checkout -b feature/amazing-feature\`)
3. Commit your changes (\`git commit -m 'Add some amazing feature'\`)
4. Push to the branch (\`git push origin feature/amazing-feature\`)
5. Open a Pull Request
Please read [CONTRIBUTING.md] for details on our code of conduct and the process for submitting pull requests.
\n\n \n
## License
This project is licensed under the [MIT License] - see the file for details.
\n\n \n
## Acknowledgments
- Hat tip to anyone whose code was used
- Inspiration
- etc.
\n\n \n
## Contact
Your Name - [USER]
Project Link: [GitHub Link]
`,
  },
];
