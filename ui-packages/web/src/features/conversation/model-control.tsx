import { ChevronDown } from 'lucide-react'

export type ModelOption = {
  id: string
  label: string
}

type ModelControlProps = {
  value: string
  options: readonly ModelOption[]
  disabled?: boolean
  onValueChange?: (modelId: string) => void
}

export const ModelControl = ({
  value,
  options,
  disabled = false,
  onValueChange,
}: ModelControlProps) => (
  <label className="model-control" title={options.find(option => option.id === value)?.label}>
    <span className="sr-only">Model</span>
    <select
      aria-label="Model"
      value={value}
      disabled={disabled || !onValueChange}
      onChange={event => onValueChange?.(event.target.value)}
    >
      {options.map(option => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
    <ChevronDown aria-hidden="true" size={13} strokeWidth={1.75} />
  </label>
)
