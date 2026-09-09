import type { Skill } from '@earendil-works/pi-agent-core'
import localDbSkill from '@gamma-compose/local-db/skills/local-db?raw'

const localDbSkillPath = '/project/.gamma/skills/local-db/SKILL.md'

export const builtInSkillFiles: Readonly<Record<string, string>> = {
  '.gamma/skills/local-db/SKILL.md': localDbSkill,
}

export const builtInSkills: readonly Skill[] = [
  {
    name: 'local-db',
    description:
      "Use when a Gamma Compose React application needs persistent structured data stored in the user's browser.",
    content: localDbSkill,
    filePath: localDbSkillPath,
  },
]
