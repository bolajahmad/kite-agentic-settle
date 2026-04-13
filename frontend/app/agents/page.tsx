"use client"

import { truncateString } from "@/lib/utils"
import { useKiteData } from "@/utils/hooks/use-kite-data"
import {
  Bot,
  ChevronRight,
  Filter,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { formatUnits } from "viem"

export default function AgentsPage() {
  const { agents, isLoading } = useKiteData()

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-kite-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-kite-primary">
            Agents
          </h1>
          <p className="mt-1 text-slate-500">
            Manage your autonomous AI workforce
          </p>
        </div>
        <Link
          href="/agents/create"
          className="kite-button-primary shadow-xl shadow-kite-primary/20"
        >
          <Plus size={20} /> Register New Agent
        </Link>
      </div>

      {/* Featured Agents */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <Link
            key={agent.agentId}
            href={`/agents/${agent.agentId}`}
            className="kite-card group relative overflow-hidden p-8 hover:-translate-y-1"
          >
            <div className="absolute top-0 right-0 p-4">
              <span className="flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-kite-primary opacity-20"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-kite-primary"></span>
              </span>
            </div>

            <div className="space-y-6">
              <div className="flex items-center gap-5">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-kite-border bg-kite-bg text-kite-primary shadow-sm transition-all duration-500 group-hover:bg-kite-primary group-hover:text-white">
                  <Bot size={32} />
                </div>
                <div>
                  <h3 className="font-display text-xl font-bold text-kite-primary">
                    {agent.metadata.name}
                  </h3>
                  <p className="font-mono text-sm text-slate-400">
                    {agent.metadata.category}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t border-kite-border pt-4">
                <div>
                  <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                    Daily Limit
                  </p>
                  <p className="font-display text-lg font-bold text-kite-text">
                    {formatUnits(
                      BigInt(agent.sessions[0].dailyLimit || 0n),
                      18
                    )}{" "}
                    USDT
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                    Spent Today
                  </p>
                  <p className="font-display text-lg font-bold text-kite-accent">
                    {formatUnits(
                      BigInt(agent.sessions[0].valueLimit || 0n),
                      18
                    )}{" "}
                    USDT
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex -space-x-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-kite-bg"
                    >
                      <Image
                        src={`https://picsum.photos/seed/agent${i}/32/32`}
                        alt="tool"
                        referrerPolicy="no-referrer"
                        width={32}
                        height={32}
                      />
                    </div>
                  ))}
                </div>
                <span className="flex items-center gap-1 text-xs font-bold text-kite-primary">
                  View Details <ChevronRight size={14} />
                </span>
              </div>
            </div>
          </Link>
        ))}

        {/* Add New Agent Card */}
        <Link
          href="/agents/create"
          className="group flex min-h-70 flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-kite-border bg-kite-bg/30 p-8 transition-all hover:border-kite-primary/50 hover:bg-white"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-kite-border bg-white text-slate-400 shadow-sm transition-all group-hover:border-kite-primary/30 group-hover:text-kite-primary">
            <Plus size={32} />
          </div>
          <div className="text-center">
            <p className="font-display text-lg font-bold text-slate-500 transition-colors group-hover:text-kite-primary">
              Register New Agent
            </p>
            <p className="mt-1 max-w-50 text-sm text-slate-400">
              Add another autonomous agent to your wallet.
            </p>
          </div>
        </Link>
      </div>

      {/* Agent Table */}
      <div className="kite-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-kite-border bg-kite-bg/30 p-8">
          <h3 className="font-display text-xl font-bold text-kite-primary">
            All Registered Agents
          </h3>
          <div className="flex gap-3">
            <div className="relative">
              <Search
                className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
                size={16}
              />
              <input
                placeholder="Search agents..."
                className="w-64 rounded-full border border-kite-border bg-white py-2 pr-4 pl-10 text-sm outline-none focus:ring-2 focus:ring-kite-primary/20"
              />
            </div>
            <button className="rounded-full border border-kite-border bg-white p-2 text-slate-500 transition-colors hover:text-kite-primary">
              <Filter size={18} />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-kite-bg/10 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                <th className="px-8 py-5">Agent</th>
                <th className="px-8 py-5">Status</th>
                <th className="px-8 py-5">Wallet Address</th>
                <th className="px-8 py-5">Daily Spend</th>
                <th className="px-8 py-5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-kite-border">
              {agents.map((agent) => (
                <tr
                  key={agent.agentId}
                  className="group transition-colors hover:bg-kite-bg/50"
                >
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-kite-border bg-white text-slate-400 transition-colors group-hover:text-kite-primary">
                        <Bot size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-kite-text">
                          {agent.metadata.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {agent.metadata.category}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-kite-primary/10 px-3 py-1 text-[10px] font-bold tracking-wider text-kite-primary uppercase">
                      <span className="h-1.5 w-1.5 rounded-full bg-kite-primary" />{" "}
                      Active
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <code className="rounded-md bg-kite-bg px-2 py-1 font-mono text-xs text-slate-400">
                      {truncateString(agent.agentAddress)}
                    </code>
                  </td>
                  <td className="px-8 py-6">
                    <div className="w-full max-w-30 space-y-1.5">
                      <div className="flex justify-between text-[10px] font-bold text-slate-400">
                        <span>12.4 KTT</span>
                        <span>100 KTT</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full border border-kite-border/50 bg-kite-bg">
                        <div
                          className="h-full rounded-full bg-kite-primary"
                          style={{ width: "12.4%" }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex gap-2">
                      <Link
                        href={`/agents/${agent.agentId}`}
                        className="rounded-lg border border-transparent p-2 text-slate-400 transition-all hover:border-kite-border hover:bg-white hover:text-kite-primary"
                      >
                        <Settings size={18} />
                      </Link>
                      <button className="rounded-lg border border-transparent p-2 text-slate-400 transition-all hover:border-kite-border hover:bg-white hover:text-red-500">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
