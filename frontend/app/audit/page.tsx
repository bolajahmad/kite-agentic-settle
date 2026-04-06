"use client";

import { cn } from '@/lib/utils';
import { History, Shield, CheckCircle2, ExternalLink, Search, Filter, ArrowRight, Zap, AlertCircle } from 'lucide-react';
import { useState } from 'react';

const auditLogs = [
  { id: '1', type: 'Payment', agent: 'Research Assistant', service: 'WeatherCo', amount: '0.1 KTT', status: 'Verified', hash: '0xabc...123', date: '2026-04-03 10:30:12' },
  { id: '2', type: 'Rule Change', agent: 'Research Assistant', service: '-', amount: '-', status: 'Verified', hash: '0xdef...456', date: '2026-04-03 09:15:45' },
  { id: '3', type: 'Channel Open', agent: 'Trading Bot', service: 'FinData', amount: '250 KTT', status: 'Verified', hash: '0xghi...789', date: '2026-04-02 18:22:10' },
  { id: '4', type: 'Payment', agent: 'Trading Bot', service: 'FinData', amount: '0.05 KTT', status: 'Verified', hash: '0xjkl...012', date: '2026-04-02 17:45:33' },
  { id: '5', type: 'Agent Reg', agent: 'New Agent', service: '-', amount: '-', status: 'Verified', hash: '0xmno...345', date: '2026-04-01 12:00:00' },
];

export default function AuditPage() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight text-kite-primary">Merkle Audit Trail</h1>
          <p className="text-slate-500 mt-1">Verifiable proof of all agent activity and payments</p>
        </div>
        <div className="flex gap-3">
          <button className="kite-button-secondary">
            <History size={18} /> Export Logs
          </button>
          <button className="kite-button-primary shadow-lg shadow-kite-primary/20">
            <Shield size={18} /> Verify State
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
        {/* Main Audit Trail */}
        <div className="lg:col-span-3 space-y-8">
          {/* Search and Filters */}
          <div className="flex flex-col md:flex-row gap-6">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input 
                type="text"
                placeholder="Search by agent, service, or transaction hash..."
                className="w-full pl-12 pr-6 py-4 bg-white border border-kite-border rounded-2xl text-lg outline-none focus:ring-2 focus:ring-kite-primary/20 shadow-sm transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button className="kite-button-secondary px-8 py-4 rounded-2xl font-bold whitespace-nowrap transition-all border bg-white text-slate-500 border-kite-border hover:border-kite-primary/30">
              <Filter size={20} /> Filters
            </button>
          </div>

          <div className="kite-card overflow-hidden">
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left text-sm">
                <thead className="bg-kite-bg text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-8 py-5">Timestamp</th>
                    <th className="px-8 py-5">Event Type</th>
                    <th className="px-8 py-5">Agent</th>
                    <th className="px-8 py-5">Service</th>
                    <th className="px-8 py-5">Amount</th>
                    <th className="px-8 py-5">Status</th>
                    <th className="px-8 py-5">Merkle Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-kite-border">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-kite-bg/50 transition-colors group">
                      <td className="px-8 py-6 text-slate-500 font-mono text-xs">{log.date}</td>
                      <td className="px-8 py-6">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border",
                          log.type === 'Payment' ? "bg-kite-primary/10 text-kite-primary border-kite-primary/20" : "bg-kite-accent/10 text-kite-accent border-kite-accent/20"
                        )}>
                          {log.type}
                        </span>
                      </td>
                      <td className="px-8 py-6 font-bold text-kite-primary">{log.agent}</td>
                      <td className="px-8 py-6 text-slate-600">{log.service}</td>
                      <td className="px-8 py-6 font-display font-bold text-kite-primary">{log.amount}</td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-2 text-kite-primary font-bold text-xs">
                          <CheckCircle2 size={14} />
                          {log.status}
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <a href="#" className="text-kite-accent hover:underline flex items-center gap-1 text-xs font-bold transition-colors">
                          {log.hash} <ExternalLink size={14} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-6 border-t border-kite-border bg-kite-bg/20 flex items-center justify-center">
              <button className="text-sm font-bold text-kite-primary hover:underline flex items-center gap-2">
                Load More History <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar Context */}
        <div className="space-y-8">
          <div className="kite-card p-8 space-y-8">
            <div className="flex items-center gap-3 text-kite-primary">
              <Shield size={24} />
              <h3 className="text-lg font-display font-bold">State Integrity</h3>
            </div>
            <div className="space-y-6">
              <div className="p-5 bg-kite-bg border border-kite-border rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-kite-primary">
                  <CheckCircle2 size={20} />
                  <span className="font-bold">Merkle Root</span>
                </div>
                <p className="text-xs font-mono text-slate-500 break-all">0x7f8e...9a2b3c4d5e6f</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Last anchored 12 mins ago</p>
              </div>
              <div className="p-5 bg-kite-bg border border-kite-border rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-kite-accent">
                  <Zap size={20} />
                  <span className="font-bold">Total Events</span>
                </div>
                <p className="text-3xl font-display font-bold">12,458</p>
                <p className="text-xs text-slate-500">All cryptographically verified</p>
              </div>
            </div>
            <div className="pt-6 border-t border-kite-border">
              <button className="w-full py-3 bg-kite-primary text-white font-bold text-sm rounded-xl hover:opacity-90 transition-all shadow-lg shadow-kite-primary/20">
                Run Full Audit
              </button>
            </div>
          </div>

          <div className="kite-card p-8 bg-kite-accent/5 border-kite-accent/20 space-y-4">
            <div className="flex items-center gap-3 text-kite-accent">
              <AlertCircle size={20} />
              <h4 className="font-bold">Verification Note</h4>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              All agent actions are anchored to the Kite L1 every 100 blocks. This provides immutable proof of spending.
            </p>
            <button className="w-full py-2 bg-white border border-kite-accent/30 text-kite-accent font-bold text-xs rounded-lg hover:bg-kite-bg transition-all">
              Learn More
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
