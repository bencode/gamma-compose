import { blankProject } from './blank-project'
import type { ProjectSnapshot } from './store'

export const showcaseProject: ProjectSnapshot = {
  entry: 'src/main.tsx',
  files: {
    'src/main.tsx': blankProject.files['src/main.tsx'] as string,
    'src/app.tsx': `import { Route, Routes } from 'react-router-dom'
import { Home } from './pages/home'

export const App = () => <Routes><Route path="*" element={<Home />} /></Routes>
`,
    'src/pages/home.tsx': `import { Faq } from '../components/faq'

const features = [
  ['Make space', 'One quiet place for the ideas, links and loose ends worth keeping.'],
  ['Find your thread', 'Bring related notes together. Keep the context, lose the clutter.'],
  ['Move it forward', 'Turn a passing thought into the next small thing you can do.'],
]

export const Home = () => (
  <main>
    <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-10" aria-label="Main navigation">
      <a href="#home" onClick={event => { event.preventDefault(); document.getElementById('home')?.scrollIntoView() }} className="text-xl font-semibold tracking-tight">folio<span className="text-lime-300">.</span></a>
      <a href="#questions" onClick={event => { event.preventDefault(); document.getElementById('questions')?.scrollIntoView() }} className="text-sm text-slate-300 hover:text-white">A few questions ↗</a>
    </nav>
    <section id="home" className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-14 sm:px-10 lg:grid-cols-2 lg:py-20">
      <div>
        <p className="mb-5 text-sm text-lime-300">A notebook for things in progress</p>
        <h1 className="max-w-xl text-5xl leading-[1.08] font-medium tracking-tight sm:text-6xl">Good ideas need<br />a place to land.</h1>
        <p className="mt-6 max-w-md text-lg leading-relaxed text-slate-300">Meet Folio. A small, thoughtful space to collect what catches your eye and shape what comes next.</p>
        <a href="#features" onClick={event => { event.preventDefault(); document.getElementById('features')?.scrollIntoView() }} className="mt-8 inline-flex rounded-md bg-lime-300 px-5 py-3 font-medium text-slate-950 hover:bg-lime-200">Take a look <span className="ml-5" aria-hidden="true">↓</span></a>
      </div>
      <div className="rounded-xl bg-slate-800 p-5 sm:p-7" aria-label="Example notebook">
        <div className="mb-6 flex items-center justify-between border-b border-slate-600 pb-4 text-sm"><span>On my mind</span><span className="text-slate-400">3 notes</span></div>
        <article className="rounded-lg bg-lime-200 p-6 text-slate-950">
          <p className="mb-10 text-sm">An idea for Saturday</p>
          <h2 className="max-w-xs text-3xl leading-tight font-medium">Less scrolling.<br />More making.</h2>
          <p className="mt-4 text-sm">A camera, a long walk, no particular plan.</p>
        </article>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-700 p-4 text-sm"><span>Places to get a little lost</span><span aria-hidden="true">↗</span></div>
        <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-700 p-4 text-sm"><span>That book Maya mentioned</span><span aria-hidden="true">↗</span></div>
      </div>
    </section>
    <section id="features" className="border-y border-slate-700 bg-slate-900">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 sm:grid-cols-3 sm:px-10">
        {features.map(([title, description]) => <article key={title}><h2 className="mb-3 text-lg font-medium">{title}</h2><p className="leading-relaxed text-slate-300">{description}</p></article>)}
      </div>
    </section>
    <Faq />
    <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-6 py-8 text-sm text-slate-400 sm:px-10"><span>folio. Make room for your thoughts.</span><span>A fictional product demo.</span></footer>
  </main>
)
`,
    'src/components/faq.tsx': `const questions = [
  ['What can I keep in Folio?', 'Notes, ideas and the little things you want to come back to. This demo gives you a glimpse of that space.'],
  ['Is this a real product?', 'Folio is a fictional product page built to explore a different starting point in Gamma Compose.'],
  ['Can I make it my own?', 'Absolutely. Ask the assistant to change the story, the layout or the visual style.'],
]

export const Faq = () => (
  <section id="questions" className="mx-auto max-w-3xl px-6 py-16 sm:px-10">
    <h2 className="mb-8 text-3xl font-medium tracking-tight">A few things to know.</h2>
    {questions.map(([question, answer]) => (
      <details key={question} className="border-b border-slate-700 py-5">
        <summary className="cursor-pointer text-base font-medium">{question}</summary>
        <p className="mt-4 max-w-xl leading-relaxed text-slate-300">{answer}</p>
      </details>
    ))}
  </section>
)
`,
    'src/styles.css': `body { min-width: 0; background: #101a2b; color: #f8fafc; }
h1, h2 { text-wrap: balance; }
a:focus-visible, summary:focus-visible { outline: 2px solid #bef264; outline-offset: 4px; }
`,
    'README.md': `# Product showcase

Folio is a fictional notebook product. This template includes an introduction,
feature sections and an expandable FAQ, with no remote assets or network requests.
The entry is src/main.tsx. MemoryRouter isolates preview navigation from the editor.
Use @gamma-compose/ui for built-in components. Files save locally in the browser.
`,
  },
}
