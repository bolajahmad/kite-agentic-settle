"use client";

import { 
  Shield, 
  History, 
  Settings, 
  Activity, 
  ExternalLink, 
  Key, 
  Plus,
  Trash2,
  AlertCircle,
  ArrowLeft,
  Bot,
  Zap,
  MessageSquare
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AgentChat } from './(components)/agent-chat';
import Link from 'next/link';

export default function AgentDetailPage({
  params,
}: {
  params: { id: string }
}) {
const { id } = params;
  const [activeTab, setActiveTab] = useState<'chat' | 'rules' | 'history'>('chat');

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <Link href="/agents" className="p-3 bg-white border border-kite-border rounded-2xl text-slate-400 hover:text-kite-primary transition-all shadow-sm">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 bg-kite-primary rounded-2xl flex items-center justify-center text-white shadow-lg shadow-kite-primary/20">
              <Bot size={32} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-display font-bold text-kite-primary">Research Assistant</h1>
                <span className="px-2 py-0.5 bg-kite-primary/10 text-kite-primary text-[10px] font-bold rounded-full uppercase tracking-wider">Active</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2 h-2 rounded-full bg-kite-primary animate-pulse" />
                <span className="text-sm font-mono text-slate-500">research-bot.kite • 0x71c...3f2</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button className="kite-button-secondary">
            <Settings size={18} /> Settings
          </button>
          <button className="kite-button-primary shadow-lg shadow-kite-primary/20">
            <Zap size={18} /> Instant Pay
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
        {/* Main Content Area */}
        <div className="lg:col-span-3 space-y-8">
          {/* Tabs */}
          <div className="flex gap-2 p-1.5 bg-kite-bg border border-kite-border rounded-2xl w-fit">
            {[
              { id: 'chat', label: 'Agent Chat', icon: MessageSquare },
              { id: 'rules', label: 'Spending Rules', icon: Shield },
              { id: 'history', label: 'Payment History', icon: History },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={cn(
                  "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all",
                  activeTab === tab.id
                    ? "bg-white text-kite-primary shadow-sm border border-kite-border"
                    : "text-slate-500 hover:text-kite-primary"
                )}
              >
                <tab.icon size={18} />
                {tab.label}
              </button>
            ))}
          </div>

          <div className="kite-card min-h-[600px] flex flex-col overflow-hidden">
            {activeTab === 'chat' && <AgentChat agentName="Research Assistant" />}
            
            {activeTab === 'rules' && (
              <div className="p-10 space-y-10">
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-display font-bold text-kite-primary">Active Spending Rules</h3>
                  <button className="kite-button-primary px-5 py-2 text-sm">
                    <Plus size={16} /> Add Session Key
                  </button>
                </div>

                <div className="bg-white border border-kite-border rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-kite-bg text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="px-8 py-5">Session Key</th>
                        <th className="px-8 py-5">Per-Tx Limit</th>
                        <th className="px-8 py-5">Daily Limit</th>
                        <th className="px-8 py-5">Valid Until</th>
                        <th className="px-8 py-5">Status</th>
                        <th className="px-8 py-5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-kite-border">
                      <tr className="hover:bg-kite-bg/50 transition-colors">
                        <td className="px-8 py-6 font-mono text-xs text-slate-600">0x71c...3f2</td>
                        <td className="px-8 py-6 font-bold text-kite-primary">10 KTT</td>
                        <td className="px-8 py-6 font-bold text-kite-primary">100 KTT</td>
                        <td className="px-8 py-6 text-slate-500">2026-12-31</td>
                        <td className="px-8 py-6">
                          <span className="px-2 py-0.5 bg-kite-primary/10 text-kite-primary text-[10px] font-bold rounded-full uppercase tracking-wider">Active</span>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <button className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={18} /></button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'history' && (
              <div className="p-10 space-y-10">
                <h3 className="text-2xl font-display font-bold text-kite-primary">Payment History</h3>
                <div className="bg-white border border-kite-border rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-kite-bg text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="px-8 py-5">Timestamp</th>
                        <th className="px-8 py-5">Service</th>
                        <th className="px-8 py-5">Amount</th>
                        <th className="px-8 py-5">Method</th>
                        <th className="px-8 py-5">Tx Hash</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-kite-border">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <tr key={i} className="hover:bg-kite-bg/50 transition-colors">
                          <td className="px-8 py-6 text-slate-500">2026-04-03 10:30</td>
                          <td className="px-8 py-6 font-bold text-kite-primary">Weather API</td>
                          <td className="px-8 py-6 font-bold text-kite-accent">0.1 KTT</td>
                          <td className="px-8 py-6">
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded uppercase tracking-widest border border-kite-border/50">x402</span>
                          </td>
                          <td className="px-8 py-6">
                            <a href="#" className="text-kite-primary hover:text-kite-accent flex items-center gap-1 text-xs font-bold transition-colors">
                              0xabc... <ExternalLink size={14} />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Context */}
        <div className="space-y-8">
          <div className="kite-card p-8 space-y-8">
            <h3 className="text-lg font-display font-bold text-kite-primary">Agent Context</h3>
            
            <div className="space-y-6">
              <div>
                <div className="flex justify-between mb-2">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Daily Limit Utilization</p>
                  <span className="text-[10px] font-bold text-kite-primary">12.4%</span>
                </div>
                <div className="h-2.5 bg-kite-bg border border-kite-border rounded-full overflow-hidden">
                  <div className="h-full bg-kite-primary transition-all shadow-[0_0_8px_rgba(77,93,33,0.3)]" style={{ width: '12.45%' }} />
                </div>
                <div className="flex justify-between mt-2 text-[10px] font-bold">
                  <span className="text-kite-primary">12.45 KTT spent</span>
                  <span className="text-slate-400">100 KTT limit</span>
                </div>
              </div>

              <div className="pt-6 border-t border-kite-border space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Active Channels</span>
                  <span className="font-bold text-kite-primary">0</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Batch Sessions</span>
                  <span className="font-bold text-kite-primary">1</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Total Spent</span>
                  <span className="font-bold text-kite-primary">156.78 KTT</span>
                </div>
              </div>
            </div>
            
            <div className="pt-6 border-t border-kite-border">
              <button className="w-full py-3 bg-red-50 text-red-600 font-bold text-sm rounded-xl hover:bg-red-100 transition-all">
                Revoke All Permissions
              </button>
            </div>
          </div>

          <div className="kite-card p-8 bg-kite-accent/5 border-kite-accent/20 space-y-4">
            <div className="flex items-center gap-3 text-kite-accent">
              <AlertCircle size={20} />
              <h4 className="font-bold">Approval Required</h4>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              This agent is configured to require manual approval for payments above **5.0 KTT**.
            </p>
            <button className="w-full py-3 bg-kite-accent text-white rounded-xl text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-kite-accent/20">
              Adjust Threshold
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
