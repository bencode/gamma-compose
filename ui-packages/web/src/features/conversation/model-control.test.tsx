import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelControl } from './model-control'

describe('ModelControl', () => {
  it('reports a selected model through its frontend-only change contract', () => {
    const onValueChange = vi.fn()
    render(
      <ModelControl
        value="model-a"
        options={[
          { id: 'model-a', label: 'Model A' },
          { id: 'model-b', label: 'Model B' },
        ]}
        onValueChange={onValueChange}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), {
      target: { value: 'model-b' },
    })

    expect(onValueChange).toHaveBeenCalledWith('model-b')
  })

  it('shows a read-only current model when no switching callback exists', () => {
    render(<ModelControl value="glm-5.3" options={[{ id: 'glm-5.3', label: 'GLM 5.3' }]} />)

    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled()
  })
})
