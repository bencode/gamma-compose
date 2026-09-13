import type { Template } from '../../core/project/records'

type TemplateListProps = {
  templates: Template[]
  creating?: string
  onCreate: (templateId: string) => void
}

export const TemplateList = ({ templates, creating, onCreate }: TemplateListProps) => (
  <section aria-labelledby="templates-heading" className="mt-10">
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="templates-heading" className="text-lg font-semibold">
        Templates
      </h2>
      <p className="text-xs text-muted">Each template starts a new project.</p>
    </div>
    <div className="grid gap-5 md:grid-cols-3">
      {templates.map(template => (
        <button
          type="button"
          key={template.id}
          aria-label={`Start with ${template.name}`}
          disabled={creating !== undefined}
          onClick={() => onCreate(template.id)}
          className="group overflow-hidden rounded-xl border border-line text-left transition-colors hover:border-accent disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
        >
          <img
            src={`/templates/${template.id}.png`}
            alt=""
            width="1000"
            height="625"
            className="aspect-[8/5] w-full border-b border-line object-cover object-top"
          />
          <div className="p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">{template.name}</h3>
              <span aria-hidden="true" className="text-accent">
                ↗
              </span>
            </div>
            <p className="mt-2 min-h-10 text-sm leading-relaxed text-muted">
              {template.description}
            </p>
            <p className="mt-5 text-xs font-medium text-accent">
              {creating === template.id ? 'Creating…' : 'Use template'}
            </p>
          </div>
        </button>
      ))}
    </div>
  </section>
)
