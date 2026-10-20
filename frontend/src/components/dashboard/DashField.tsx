import type { ReactNode } from 'react'

interface DashFieldProps {
  label: string
  htmlFor?: string
  icon: ReactNode
  trailing?: ReactNode
  children: ReactNode
}

/** Shared trip-form control: label above, icon + input in one 44px shell. */
export function DashField({ label, htmlFor, icon, trailing, children }: DashFieldProps) {
  return (
    <div className="min-w-0">
      <label
        htmlFor={htmlFor}
        className="mb-2 block text-[13px] font-medium leading-none text-slate-700"
      >
        {label}
      </label>
      <div className="dash-field flex h-11 w-full min-w-0 items-stretch overflow-hidden rounded-xl border border-slate-200 bg-slate-100 focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100">
        <span
          className="flex w-10 shrink-0 items-center justify-center text-slate-400"
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
