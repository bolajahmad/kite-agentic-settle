"use client";

import { useKiteData } from '@/utils/hooks/use-kite-data';
import { cn } from '@/utils/utils';
import { Wallet as WalletIcon, Plus, ArrowUpRight, ArrowDownLeft, History, Shield, Key, Copy, ExternalLink } from 'lucide-react';

export default function WalletPage() {
  const { address } = useKiteData();

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight text-kite-primary">Wallet Management</h1>
          <p className="text-slate-500 mt-1">Manage your KiteAAWallet and agent funding</p>
        </div>
        <div className="flex gap-3">
          <button className="kite-button-secondary">
            <History size={18} /> Transaction History
          </button>
          <button className="kite-button-primary shadow-lg shadow-kite-primary/20">
            <Plus size={18} /> Fund Wallet
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Main Wallet Card */}
        <div className="lg:col-span-2 space-y-8">
          <div className="kite-card p-10 bg-kite-primary text-white relative overflow-hidden group">
            {/* Decorative background pattern */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl group-hover:bg-white/10 transition-all duration-700" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-kite-accent/10 rounded-full translate-y-1/2 -translate-x-1/2 blur-2xl" />
            
            <div className="relative z-10 space-y-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/10 backdrop-blur-md rounded-lg border border-white/20">
                    <WalletIcon size={24} />
                  </div>
                  <span className="font-bold tracking-widest uppercase text-xs opacity-80">KiteAAWallet</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full border border-white/20 text-[10px] font-bold uppercase tracking-widest">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  Mainnet
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-bold opacity-60 uppercase tracking-widest">Available Balance</p>
                <div className="flex items-baseline gap-3">
                  <h2 className="text-6xl font-display font-bold">1,245.80</h2>
                  <span className="text-2xl font-bold opacity-80">KTT</span>
                </div>
              </div>

              <div className="pt-10 border-t border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">Wallet Address</p>
                  <div className="flex items-center gap-3 group/addr cursor-pointer">
                    <code className="text-sm font-mono opacity-90">{address || '0x71c...3f2'}</code>
                    <Copy size={14} className="opacity-40 group-hover/addr:opacity-100 transition-opacity" />
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="text-right">
                    <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">Daily Limit</p>
                    <p className="text-sm font-bold">500 / 1,000 KTT</p>
                  </div>
                  <div className="w-px h-10 bg-white/10" />
                  <div className="text-right">
                    <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">Security</p>
                    <p className="text-sm font-bold">2-of-3 Multi-sig</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <button className="kite-card p-6 bg-white hover:bg-kite-bg transition-all group flex flex-col items-center text-center space-y-4">
              <div className="w-12 h-12 bg-kite-primary/10 text-kite-primary rounded-2xl flex items-center justify-center group-hover:bg-kite-primary group-hover:text-white transition-all duration-500">
                <ArrowUpRight size={24} />
              </div>
              <div>
                <h4 className="font-bold text-kite-primary">Send Funds</h4>
                <p className="text-xs text-slate-500 mt-1">Transfer KTT to any address</p>
              </div>
            </button>
            <button className="kite-card p-6 bg-white hover:bg-kite-bg transition-all group flex flex-col items-center text-center space-y-4">
              <div className="w-12 h-12 bg-kite-accent/10 text-kite-accent rounded-2xl flex items-center justify-center group-hover:bg-kite-accent group-hover:text-white transition-all duration-500">
                <ArrowDownLeft size={24} />
              </div>
              <div>
                <h4 className="font-bold text-kite-primary">Receive</h4>
                <p className="text-xs text-slate-500 mt-1">Get your deposit address</p>
              </div>
            </button>
            <button className="kite-card p-6 bg-white hover:bg-kite-bg transition-all group flex flex-col items-center text-center space-y-4">
              <div className="w-12 h-12 bg-slate-100 text-slate-500 rounded-2xl flex items-center justify-center group-hover:bg-slate-800 group-hover:text-white transition-all duration-500">
                <Key size={24} />
              </div>
              <div>
                <h4 className="font-bold text-kite-primary">Session Keys</h4>
                <p className="text-xs text-slate-500 mt-1">Manage agent permissions</p>
              </div>
            </button>
          </div>

          {/* Recent Activity */}
          <div className="kite-card p-8 space-y-8">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-display font-bold text-kite-primary">Recent Transactions</h3>
              <button className="text-sm font-bold text-kite-primary hover:underline">View All</button>
            </div>
            <div className="space-y-6">
              {[
                { type: 'send', label: 'Agent Funding', amount: '-50.00', status: 'Confirmed', date: '2 mins ago' },
                { type: 'receive', label: 'Deposit from EOA', amount: '+200.00', status: 'Confirmed', date: '1 hour ago' },
                { type: 'send', label: 'Service Payment', amount: '-0.10', status: 'Confirmed', date: '3 hours ago' },
              ].map((tx, i) => (
                <div key={i} className="flex items-center justify-between group cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center border transition-all",
                      tx.type === 'send' 
                        ? "bg-red-50 text-red-500 border-red-100 group-hover:bg-red-500 group-hover:text-white" 
                        : "bg-green-50 text-green-500 border-green-100 group-hover:bg-green-500 group-hover:text-white"
                    )}>
                      {tx.type === 'send' ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
                    </div>
                    <div>
                      <p className="font-bold text-kite-primary">{tx.label}</p>
                      <p className="text-xs text-slate-500">{tx.date} • {tx.status}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "font-display font-bold text-lg",
                      tx.type === 'send' ? "text-slate-800" : "text-kite-primary"
                    )}>{tx.amount} KTT</p>
                    <div className="flex items-center justify-end gap-1 text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                      0xabc... <ExternalLink size={10} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-8">
          <div className="kite-card p-8 space-y-6">
            <div className="flex items-center gap-3 text-kite-primary">
              <Shield size={20} />
              <h3 className="font-display font-bold">Security Status</h3>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-kite-bg border border-kite-border rounded-xl space-y-2">
                <div className="flex justify-between text-xs font-bold uppercase tracking-widest">
                  <span className="text-slate-500">Recovery Mode</span>
                  <span className="text-kite-primary">Disabled</span>
                </div>
                <div className="h-1.5 bg-white border border-kite-border rounded-full overflow-hidden">
                  <div className="h-full bg-slate-200" style={{ width: '0%' }} />
                </div>
              </div>
              <div className="p-4 bg-kite-bg border border-kite-border rounded-xl space-y-2">
                <div className="flex justify-between text-xs font-bold uppercase tracking-widest">
                  <span className="text-slate-500">2FA Status</span>
                  <span className="text-kite-primary">Active</span>
                </div>
                <div className="h-1.5 bg-white border border-kite-border rounded-full overflow-hidden">
                  <div className="h-full bg-kite-primary" style={{ width: '100%' }} />
                </div>
              </div>
            </div>
            <button className="w-full py-3 bg-kite-bg border border-kite-border text-kite-primary font-bold text-sm rounded-xl hover:bg-white transition-all shadow-sm">
              Security Settings
            </button>
          </div>

          <div className="kite-card p-8 bg-kite-accent/5 border-kite-accent/20 space-y-4">
            <h4 className="font-display font-bold text-kite-accent">Gas Tank</h4>
            <div className="space-y-2">
              <div className="flex justify-between items-baseline">
                <p className="text-3xl font-display font-bold">45.20</p>
                <span className="text-xs font-bold opacity-60">KITE</span>
              </div>
              <p className="text-xs text-slate-500">Estimated for ~1,200 transactions</p>
            </div>
            <div className="h-2 bg-white border border-kite-border rounded-full overflow-hidden">
              <div className="h-full bg-kite-accent" style={{ width: '45%' }} />
            </div>
            <button className="w-full py-2 bg-kite-accent text-white font-bold text-xs rounded-lg hover:opacity-90 transition-all">
              Refill Gas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
