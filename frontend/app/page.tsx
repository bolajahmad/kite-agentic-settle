"use client";

import { 
  Wallet, 
  Users, 
  Activity, 
  ArrowUpRight, 
  ArrowDownLeft,
  ExternalLink,
  CheckCircle2
} from 'lucide-react';
import { formatEther } from 'viem';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { useKiteData } from '@/utils/hooks/use-kite-data';

const data = [
  { name: 'Mon', spend: 400 },
  { name: 'Tue', spend: 300 },
  { name: 'Wed', spend: 200 },
  { name: 'Thu', spend: 278 },
  { name: 'Fri', spend: 189 },
  { name: 'Sat', spend: 239 },
  { name: 'Sun', spend: 349 },
];

export default function OverviewPage() {
  const { address, agents, kttBalance, isLoading } = useKiteData();

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-kite-primary" />
    </div>;
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight text-kite-primary">Dashboard</h1>
          <p className="text-slate-500 mt-1">Welcome back, {address?.slice(0, 6)}...{address?.slice(-4)}</p>
        </div>
        <div className="flex gap-3">
          <button className="kite-button-secondary">
            <ArrowDownLeft size={18} /> Withdraw
          </button>
          <button className="kite-button-primary shadow-lg shadow-kite-primary/20">
            <ArrowUpRight size={18} /> Deposit Funds
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="kite-card p-8 space-y-4 hover:-translate-y-1">
          <div className="flex items-center justify-between">
            <div className="p-3 bg-kite-primary/5 rounded-xl text-kite-primary">
              <Wallet size={24} />
            </div>
            <span className="text-xs font-bold text-kite-accent bg-kite-accent/10 px-2.5 py-1 rounded-full">+12%</span>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">KTT Balance</p>
            <p className="text-3xl font-display font-bold mt-1">{formatEther(kttBalance)} KTT</p>
          </div>
        </div>

        <div className="kite-card p-8 space-y-4 hover:-translate-y-1">
          <div className="flex items-center justify-between">
            <div className="p-3 bg-kite-primary/5 rounded-xl text-kite-primary">
              <Users size={24} />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Active Agents</p>
            <p className="text-3xl font-display font-bold mt-1">{agents.length}</p>
          </div>
        </div>

        <div className="kite-card p-8 space-y-4 hover:-translate-y-1">
          <div className="flex items-center justify-between">
            <div className="p-3 bg-kite-primary/5 rounded-xl text-kite-primary">
              <Activity size={24} />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Today&apos;s Spend</p>
            <p className="text-3xl font-display font-bold mt-1">12.45 KTT</p>
          </div>
        </div>

        <div className="kite-card p-8 space-y-4 hover:-translate-y-1">
          <div className="flex items-center justify-between">
            <div className="p-3 bg-kite-primary/5 rounded-xl text-kite-primary">
              <CheckCircle2 size={24} />
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Success Rate</p>
            <p className="text-3xl font-display font-bold mt-1">99.8%</p>
          </div>
        </div>
      </div>

      {/* Charts & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 kite-card p-8 space-y-8">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-display font-bold text-kite-primary">Spending Activity</h3>
            <select className="bg-white border border-kite-border rounded-full px-4 py-1.5 text-sm outline-none focus:ring-2 focus:ring-kite-primary/20">
              <option>Last 7 days</option>
              <option>Last 30 days</option>
            </select>
          </div>
          <div className="h-87.5 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4D5D21" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#4D5D21" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E0D8" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} dx={-10} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E5E0D8', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ color: '#4D5D21', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="spend" stroke="#4D5D21" fillOpacity={1} fill="url(#colorSpend)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="kite-card p-8 space-y-8">
          <h3 className="text-xl font-display font-bold text-kite-primary">Recent Activity</h3>
          <div className="space-y-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center justify-between p-4 hover:bg-kite-bg rounded-2xl transition-all group border border-transparent hover:border-kite-border">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white border border-kite-border rounded-xl flex items-center justify-center text-slate-400 group-hover:text-kite-primary group-hover:border-kite-primary/30 transition-all shadow-sm">
                    <Activity size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-kite-text">Weather API Call</p>
                    <p className="text-xs text-slate-500">2 mins ago</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-kite-primary">0.1 KTT</p>
                  <p className="text-[10px] text-slate-400 flex items-center gap-1 justify-end font-mono">
                    0xabc... <ExternalLink size={10} />
                  </p>
                </div>
              </div>
            ))}
          </div>
          <button className="w-full py-3 text-sm font-bold text-kite-primary hover:bg-kite-primary/5 rounded-xl transition-all border border-kite-primary/10">
            View full audit trail
          </button>
        </div>
      </div>
    </div>
  );
}
