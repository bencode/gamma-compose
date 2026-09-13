import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

vi.stubGlobal('matchMedia', (query: string) => ({
  // jsdom has no layout; content interactions use the non-resizable narrow-screen mode.
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)

Object.defineProperties(Range.prototype, {
  getBoundingClientRect: {
    configurable: true,
    value: () => new DOMRect(),
  },
  getClientRects: {
    configurable: true,
    value: () => [],
  },
})

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true
  }
}

if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function close() {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

const dispatchPopoverToggle = (element: HTMLElement, newState: 'closed' | 'open') => {
  const before = new Event('beforetoggle', { cancelable: true })
  Object.defineProperty(before, 'newState', { value: newState })
  if (!element.dispatchEvent(before)) return
  if (newState === 'open') element.dataset.popoverOpen = ''
  else delete element.dataset.popoverOpen
  const toggle = new Event('toggle')
  Object.defineProperty(toggle, 'newState', { value: newState })
  element.dispatchEvent(toggle)
}

if (!HTMLElement.prototype.showPopover) {
  const popoverStyles = document.createElement('style')
  popoverStyles.textContent = '[popover][data-popover-open] { display: block !important; }'
  document.head.append(popoverStyles)
  HTMLElement.prototype.showPopover = function showPopover() {
    dispatchPopoverToggle(this, 'open')
  }
  HTMLElement.prototype.hidePopover = function hidePopover() {
    dispatchPopoverToggle(this, 'closed')
  }
  HTMLElement.prototype.togglePopover = function togglePopover() {
    dispatchPopoverToggle(this, this.dataset.popoverOpen === undefined ? 'open' : 'closed')
    return this.dataset.popoverOpen !== undefined
  }
  document.addEventListener('click', event => {
    const trigger = (event.target as Element | null)?.closest<HTMLElement>('[popovertarget]')
    const targetId = trigger?.getAttribute('popovertarget')
    const target = targetId ? document.getElementById(targetId) : undefined
    target?.togglePopover()
  })
}

afterEach(cleanup)
