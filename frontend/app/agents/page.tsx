"use client";

import { useKiteData } from '@/utils/hooks/use-kite-data';
import { 
  Plus, 
  Search, 
  Settings, 
  Bot,
  ChevronRight,
  Filter,
  Trash2
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

export default function AgentsPage() {
  const { agents, isLoading } = useKiteData();

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kite-primary" />
    </div>;
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight text-kite-primary">Agents</h1>
          <p className="text-slate-500 mt-1">Manage your autonomous AI workforce</p>
        </div>
        <button className="kite-button-primary shadow-xl shadow-kite-primary/20">
          <Plus size={20} /> Register New Agent
        </button>
      </div>

      {/* Featured Agents */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {agents.map((agent) => (
          <Link 
            key={agent.id} 
            href={`/agents/${agent.id}`}
            className="kite-card p-8 group hover:-translate-y-1 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-4">
              <span className="flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-kite-primary opacity-20"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-kite-primary"></span>
              </span>
            </div>

            <div className="space-y-6">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 bg-kite-bg border border-kite-border rounded-2xl flex items-center justify-center text-kite-primary group-hover:bg-kite-primary group-hover:text-white transition-all duration-500 shadow-sm">
                  <Bot size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-display font-bold text-kite-primary">{agent.name}</h3>
                  <p className="text-sm font-mono text-slate-400">{agent.domain}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-kite-border">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Daily Limit</p>
                  <p className="text-lg font-display font-bold text-kite-text">100 KTT</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Spent Today</p>
                  <p className="text-lg font-display font-bold text-kite-accent">12.4 KTT</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex -space-x-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-kite-bg flex items-center justify-center overflow-hidden">
                      <Image src={`https://picsum.photos/seed/agent${i}/32/32`} alt="tool" referrerPolicy="no-referrer" width={32} height={32} />
                    </div>
                  ))}
                </div>
                <span className="text-xs font-bold text-kite-primary flex items-center gap-1">
                  View Details <ChevronRight size={14} />
                </span>
              </div>
            </div>
          </Link>
        ))}

        {/* Add New Agent Card */}
        <button className="flex flex-col items-center justify-center gap-4 p-8 bg-kite-bg/30 border border-dashed border-kite-border rounded-3xl hover:bg-white hover:border-kite-primary/50 transition-all group min-h-70">
          <div className="w-16 h-16 bg-white border border-kite-border rounded-full flex items-center justify-center text-slate-400 group-hover:text-kite-primary group-hover:border-kite-primary/30 transition-all shadow-sm">
            <Plus size={32} />
          </div>
          <div className="text-center">
            <p className="text-lg font-display font-bold text-slate-500 group-hover:text-kite-primary transition-colors">Register New Agent</p>
            <p className="text-sm text-slate-400 mt-1 max-w-50">Add another autonomous agent to your wallet.</p>
          </div>
        </button>
      </div>

      {/* Agent Table */}
      <div className="kite-card overflow-hidden">
        <div className="p-8 border-b border-kite-border flex items-center justify-between bg-kite-bg/30">
          <h3 className="text-xl font-display font-bold text-kite-primary">All Registered Agents</h3>
          <div className="flex gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                placeholder="Search agents..." 
                className="pl-10 pr-4 py-2 bg-white border border-kite-border rounded-full text-sm outline-none focus:ring-2 focus:ring-kite-primary/20 w-64"
              />
            </div>
            <button className="p-2 bg-white border border-kite-border rounded-full text-slate-500 hover:text-kite-primary transition-colors">
              <Filter size={18} />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-kite-bg/10">
                <th className="px-8 py-5">Agent</th>
                <th className="px-8 py-5">Status</th>
                <th className="px-8 py-5">Wallet Address</th>
                <th className="px-8 py-5">Daily Spend</th>
                <th className="px-8 py-5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-kite-border">
              {agents.map((agent) => (
                <tr key={agent.id} className="hover:bg-kite-bg/50 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-white border border-kite-border rounded-xl flex items-center justify-center text-slate-400 group-hover:text-kite-primary transition-colors">
                        <Bot size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-kite-text">{agent.name}</p>
                        <p className="text-xs text-slate-500">{agent.domain}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-kite-primary/10 text-kite-primary uppercase tracking-wider">
                      <span className="w-1.5 h-1.5 rounded-full bg-kite-primary" />{" "}
                      Active
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <code className="text-xs font-mono text-slate-400 bg-kite-bg px-2 py-1 rounded-md">
                      {agent.address.slice(0, 6)}...{agent.address.slice(-4)}
                    </code>
                  </td>
                  <td className="px-8 py-6">
                    <div className="w-full max-w-30 space-y-1.5">
                      <div className="flex justify-between text-[10px] font-bold text-slate-400">
                        <span>12.4 KTT</span>
                        <span>100 KTT</span>
                      </div>
                      <div className="h-1.5 w-full bg-kite-bg rounded-full overflow-hidden border border-kite-border/50">
                        <div className="h-full bg-kite-primary rounded-full" style={{ width: '12.4%' }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex gap-2">
                      <Link 
                        href={`/agents/${agent.id}`}
                        className="p-2 text-slate-400 hover:text-kite-primary hover:bg-white rounded-lg transition-all border border-transparent hover:border-kite-border"
                      >
                        <Settings size={18} />
                      </Link>
                      <button className="p-2 text-slate-400 hover:text-red-500 hover:bg-white rounded-lg transition-all border border-transparent hover:border-kite-border">
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
  );
}
