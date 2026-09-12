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

afterEach(cleanup)
