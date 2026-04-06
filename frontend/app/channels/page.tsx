"use client";

import { cn } from '@/lib/utils';
import { Shield, Plus, ArrowRight, Clock, Zap, ExternalLink, Filter, AlertCircle } from 'lucide-react';
import { useState } from 'react';

const channels = [
  { id: '1', provider: 'OpenAI', type: 'Postpaid', limit: '500 KTT', used: '124.50 KTT', status: 'Active', date: '2026-03-15' },
  { id: '2', provider: 'WeatherCo', type: 'Prepaid', limit: '100 KTT', used: '85.20 KTT', status: 'Active', date: '2026-03-20' },
  { id: '3', provider: 'FinData', type: 'Postpaid', limit: '250 KTT', used: '0.00 KTT', status: 'Pending', date: '2026-04-01' },
];

export default function ChannelsPage() {
  const [activeTab, setActiveTab] = useState('active');

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight text-kite-primary">Payment Channels</h1>
          <p className="text-slate-500 mt-1">Manage direct payment relationships with API providers</p>
        </div>
        <div className="flex gap-3">
          <button className="kite-button-secondary">
            <Filter size={18} /> Filters
          </button>
          <button className="kite-button-primary shadow-lg shadow-kite-primary/20">
            <Plus size={18} /> Open New Channel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
        {/* Main Channels List */}
        <div className="lg:col-span-3 space-y-8">
          {/* Tabs */}
          <div className="flex gap-2 p-1.5 bg-kite-bg border border-kite-border rounded-2xl w-fit">
            {[
              { id: 'active', label: 'Active Channels', count: 2 },
              { id: 'pending', label: 'Pending Approvals', count: 1 },
              { id: 'closed', label: 'Closed History', count: 12 },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-3 px-6 py-3 rounded-xl text-sm font-bold transition-all",
                  activeTab === tab.id
                    ? "bg-white text-kite-primary shadow-sm border border-kite-border"
                    : "text-slate-500 hover:text-kite-primary"
                )}
              >
                {tab.label}
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-bold border",
                  activeTab === tab.id ? "bg-kite-primary text-white border-kite-primary" : "bg-white text-slate-400 border-kite-border"
                )}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {channels.filter(c => c.status.toLowerCase() === activeTab || (activeTab === 'active' && c.status === 'Active')).map((channel) => (
              <div key={channel.id} className="kite-card group hover:-translate-y-1 flex flex-col">
                <div className="p-8 space-y-8">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-kite-bg border border-kite-border rounded-2xl flex items-center justify-center text-kite-primary shadow-sm group-hover:bg-kite-primary group-hover:text-white transition-all duration-500">
                        <Shield size={28} />
                      </div>
                      <div>
                        <h3 className="text-2xl font-display font-bold text-kite-primary">{channel.provider}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border",
                            channel.type === 'Postpaid' ? "bg-kite-accent/10 text-kite-accent border-kite-accent/20" : "bg-kite-primary/10 text-kite-primary border-kite-primary/20"
                          )}>
                            {channel.type}
                          </span>
                          <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Opened {channel.date}</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-2 bg-kite-bg rounded-lg border border-kite-border text-slate-400 group-hover:text-kite-primary transition-colors">
                      <ExternalLink size={18} />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-end">
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Channel Utilization</p>
                        <p className="text-2xl font-display font-bold text-kite-primary">{channel.used} / {channel.limit}</p>
                      </div>
                      <p className="text-sm font-bold text-kite-primary">
                        {Math.round((Number.parseFloat(channel.used) / Number.parseFloat(channel.limit)) * 100)}%
                      </p>
                    </div>
                    <div className="h-2.5 bg-kite-bg border border-kite-border rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-kite-primary transition-all shadow-[0_0_8px_rgba(77,93,33,0.3)]" 
                        style={{ width: `${(Number.parseFloat(channel.used) / Number.parseFloat(channel.limit)) * 100}%` }} 
                      />
                    </div>
                  </div>

                  <div className="pt-6 border-t border-kite-border flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Settlement</span>
                        <span className="text-xs font-bold">Every 24h</span>
                      </div>
                      <div className="w-px h-8 bg-kite-border" />
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Dispute</span>
                        <span className="text-xs font-bold">48h Window</span>
                      </div>
                    </div>
                    <button className="kite-button-secondary px-5 py-2 text-sm">
                      Manage <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar Context */}
        <div className="space-y-8">
          <div className="kite-card p-8 space-y-8">
            <h3 className="text-lg font-display font-bold text-kite-primary">Channel Insights</h3>
            <div className="space-y-6">
              <div className="p-5 bg-kite-bg border border-kite-border rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-kite-primary">
                  <Zap size={20} />
                  <span className="font-bold">Total Liquidity</span>
                </div>
                <p className="text-3xl font-display font-bold">850 KTT</p>
                <p className="text-xs text-slate-500">Locked in 3 active channels</p>
              </div>
              <div className="p-5 bg-kite-bg border border-kite-border rounded-2xl space-y-4">
                <div className="flex items-center gap-3 text-kite-accent">
                  <Clock size={20} />
                  <span className="font-bold">Pending Settlement</span>
                </div>
                <p className="text-3xl font-display font-bold">12.45 KTT</p>
                <p className="text-xs text-slate-500">Next batch in 4h 12m</p>
              </div>
            </div>
            <div className="pt-6 border-t border-kite-border">
              <button className="w-full py-3 bg-kite-primary text-white font-bold text-sm rounded-xl hover:opacity-90 transition-all shadow-lg shadow-kite-primary/20">
                Settle All Channels
              </button>
            </div>
          </div>

          <div className="kite-card p-8 bg-kite-accent/5 border-kite-accent/20 space-y-4">
            <div className="flex items-center gap-3 text-kite-accent">
              <AlertCircle size={20} />
              <h4 className="font-bold text-kite-accent">Dispute Alert</h4>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              **WeatherCo** has challenged a batch of 0.5 KTT. You have 24h to respond.
            </p>
            <button className="w-full py-2 bg-kite-accent text-white font-bold text-xs rounded-lg hover:opacity-90 transition-all">
              Review Dispute
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
