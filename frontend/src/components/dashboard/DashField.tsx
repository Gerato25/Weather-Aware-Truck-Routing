import type { ReactNode } from 'react'

interface DashFieldProps {
  label: string
  htmlFor?: string
  icon: ReactNode
  trailing?: ReactNode
  compact?: boolean
  children: ReactNode
}

/** Shared trip-form control: label above, icon + input in one shell. */
export function DashField({ label, htmlFor, icon, trailing, compact = false, children }: DashFieldProps) {
  return (
    <div className="min-w-0">
      <label
        htmlFor={htmlFor}
        className={`mb-1 block font-medium leading-none text-slate-600 ${compact ? 'text-[11px]' : 'mb-2 text-[13px] text-slate-700'}`}
      >
        {label}
      </label>
      <div
        className={`dash-field flex w-full min-w-0 items-stretch overflow-hidden border border-slate-200 bg-slate-100 focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 ${
          compact ? 'h-9 rounded-lg' : 'h-11 rounded-xl'
        }`}
      >
        <span
          className={`flex shrink-0 items-center justify-center text-slate-400 ${compact ? 'w-8' : 'w-10'}`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 items-center pr-2">{children}</div>
        {trailing}
      </div>
    </div>
  )
}

export const dashControlClass =
  'dash-control h-full w-full min-w-0 border-0 bg-transparent p-0 text-sm leading-none text-slate-900 shadow-none outline-none ring-0'
