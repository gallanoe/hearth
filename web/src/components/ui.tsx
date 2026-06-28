import { cn } from "@/lib/utils"

/** Circadian presence: ember + breath when awake, cool moon when asleep. */
export function StatusDot({ awake }: { awake: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        awake ? "animate-breathe bg-ember glow-ember" : "bg-moon",
      )}
      title={awake ? "Awake" : "Asleep"}
    />
  )
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="text-sm text-muted">{label}</p>
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="rounded-control border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-alert">
      {message}
    </p>
  )
}
