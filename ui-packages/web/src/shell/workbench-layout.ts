import type { LayoutStorage } from 'react-resizable-panels'

const desktopQuery = '(min-width: 900px)'

export const getDesktopSnapshot = () => window.matchMedia(desktopQuery).matches

export const subscribeDesktop = (notify: () => void) => {
  const query = window.matchMedia(desktopQuery)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}

const isStorageUnavailable = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === 'SecurityError' || error.name === 'QuotaExceededError')

export const desktopLayoutStorage: LayoutStorage = {
  getItem(key) {
    try {
      const value = window.localStorage.getItem(key)
      if (value === null) return null
      const layout: unknown = JSON.parse(value)
      if (
        typeof layout === 'object' &&
        layout !== null &&
        !Array.isArray(layout) &&
        Object.keys(layout).length === 2 &&
        'conversation' in layout &&
        'output' in layout &&
        Object.values(layout).every(size => typeof size === 'number' && size >= 0 && size <= 100) &&
        Math.abs(Number(layout.conversation) + Number(layout.output) - 100) < 0.01
      )
        return value
      console.warn('Ignoring an invalid saved workbench layout.')
      return null
    } catch (error) {
      if (!(error instanceof SyntaxError) && !isStorageUnavailable(error)) throw error
      console.warn('Could not restore the workbench layout.', error)
      return null
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch (error) {
      if (!isStorageUnavailable(error)) throw error
      console.warn('Could not save the workbench layout.', error)
    }
  },
}

export const mobileLayoutStorage: LayoutStorage = {
  getItem: () => null,
  setItem: () => undefined,
}
