import { blankProject } from './blank-project'
import { demoProject } from './demo-project'
import type { Template } from './records'
import { showcaseProject } from './showcase-project'

export const templates: readonly Template[] = [
  {
    ...blankProject,
    id: 'blank',
    name: 'Blank',
    description: 'A Hello page, React Router, and room for your idea.',
  },
  {
    ...demoProject,
    id: 'team-workspace',
    name: 'Team workspace',
    description: 'A working project table with search, filters, and a dialog.',
  },
  {
    ...showcaseProject,
    id: 'product-showcase',
    name: 'Product showcase',
    description: 'A thoughtful product page with a story, features, and FAQ.',
  },
]
