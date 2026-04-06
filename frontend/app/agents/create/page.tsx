import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { Toaster } from "sonner"
import { RegisterAgentFormLayout } from "./(components)/display-form"

export default function RegisterAgentPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-10 py-10">
      <Toaster position="top-center" richColors />

      {/* Header */}
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-kite-primary">
            Register New Agent
          </h1>
          <p className="mt-1 text-slate-500">
            Onboard your autonomous AI workforce to the Kite ecosystem
          </p>
        </div>
        <Link
          href="/agents"
          className="flex items-center gap-2 text-sm font-bold text-slate-500 transition-colors hover:text-kite-primary"
        >
          <ChevronLeft size={18} /> Back to Agents
        </Link>
      </div>

      <RegisterAgentFormLayout />
    </div>
  )
}
