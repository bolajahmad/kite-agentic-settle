"use client";

import { cn } from '@/lib/utils';
import { Search, Filter, Star, ArrowRight } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

const services = [
  {
    id: '1',
    name: 'Real-Time Weather API',
    provider: 'WeatherCo.kite',
    price: '0.1',
    rating: 4.8,
    calls: '12.4k',
    tags: ['Weather', 'Data'],
    modes: ['x402', 'Batch'],
    description: 'Hyper-local weather data with 1-minute resolution.',
    icon: '🌤️',
    category: 'Weather'
  },
  {
    id: '2',
    name: 'AI Sentiment Analysis',
    provider: 'NLP-Labs.kite',
    price: '0.5',
    rating: 4.9,
    calls: '85k',
    tags: ['AI', 'Finance'],
    modes: ['x402', 'Channel'],
    description: 'Advanced sentiment analysis for financial news and social media.',
    icon: '🧠',
    category: 'AI/ML'
  },
  {
    id: '3',
    name: 'Global Stock Quotes',
    provider: 'FinData.kite',
    price: '0.05',
    rating: 4.7,
    calls: '1.2M',
    tags: ['Finance', 'Real-time'],
    modes: ['Batch', 'Channel'],
    description: 'Real-time stock quotes from 50+ global exchanges.',
    icon: '📈',
    category: 'Finance'
  },
  {
    id: '4',
    name: 'Crypto Price Feed',
    provider: 'ChainLink.kite',
    price: '0.01',
    rating: 5.0,
    calls: '10M',
    tags: ['Crypto', 'Oracle'],
    modes: ['x402', 'Batch', 'Channel'],
    description: 'Decentralized price feeds for 1000+ crypto assets.',
    icon: '⛓️',
    category: 'Crypto'
  }
];

const categories = ['All', 'Weather', 'Finance', 'AI/ML', 'Crypto', 'Data', 'Compute'];

export default function MarketplacePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const filteredServices = services.filter(service => {
    const matchesSearch = service.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         service.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || service.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-display font-bold tracking-tight text-kite-primary">Marketplace</h1>
          <p className="text-slate-500 mt-1">Discover and connect to high-quality AI services</p>
        </div>
        <div className="flex gap-3">
          <button className="kite-button-secondary">
            <Filter size={18} /> Advanced Filters
          </button>
        </div>
      </div>

      {/* Search and Categories */}
      <div className="flex flex-col md:flex-row gap-6">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input 
            type="text"
            placeholder="Search services, providers, or tags..."
            className="w-full pl-12 pr-6 py-4 bg-white border border-kite-border rounded-2xl text-lg outline-none focus:ring-2 focus:ring-kite-primary/20 shadow-sm transition-all"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={cn(
                "px-6 py-4 rounded-2xl font-bold whitespace-nowrap transition-all border",
                selectedCategory === category
                  ? "bg-kite-primary text-white border-kite-primary shadow-lg shadow-kite-primary/20"
                  : "bg-white text-slate-500 border-kite-border hover:border-kite-primary/30"
              )}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* Service Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
        {filteredServices.map((service) => (
          <div key={service.id} className="kite-card group hover:-translate-y-1 flex flex-col">
            <div className="h-48 bg-kite-bg relative overflow-hidden rounded-t-2xl">
              <Image
                src={`https://picsum.photos/seed/${service.id}/600/400`} 
                alt={service.name}
                height={400}
                width={600}
                className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700"
                referrerPolicy="no-referrer"
              />
              <div className="absolute top-4 right-4 px-3 py-1 bg-white/90 backdrop-blur-sm rounded-full text-[10px] font-bold text-kite-primary uppercase tracking-widest border border-kite-border">
                {service.category}
              </div>
            </div>
            
            <div className="p-8 flex-1 flex flex-col space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-2xl font-display font-bold text-kite-primary group-hover:text-kite-accent transition-colors">{service.name}</h3>
                  <p className="text-sm text-slate-400 mt-1">by {service.provider}</p>
                </div>
                <div className="flex items-center gap-1 text-kite-accent">
                  <Star size={16} fill="currentColor" />
                  <span className="text-sm font-bold">{service.rating}</span>
                </div>
              </div>

              <p className="text-slate-600 text-sm leading-relaxed line-clamp-2">
                {service.description}
              </p>

              <div className="flex flex-wrap gap-2">
                {service.tags.map(tag => (
                  <span key={tag} className="px-2.5 py-1 bg-kite-bg text-slate-500 text-[10px] font-bold rounded-md uppercase tracking-wider border border-kite-border/50">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="pt-6 border-t border-kite-border flex items-center justify-between mt-auto">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Price per call</p>
                  <p className="text-xl font-display font-bold text-kite-primary">{service.price} KTT</p>
                </div>
                <button className="kite-button-primary px-5 py-2 text-sm shadow-md shadow-kite-primary/10">
                  Connect <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredServices.length === 0 && (
        <div className="text-center py-24 kite-card bg-kite-bg/20 border-dashed">
          <div className="w-20 h-20 bg-white border border-kite-border rounded-full flex items-center justify-center text-slate-300 mx-auto mb-6">
            <Search size={32} />
          </div>
          <h3 className="text-2xl font-display font-bold text-kite-primary">No services found</h3>
          <p className="text-slate-500 mt-2">Try adjusting your search or category filters.</p>
          <button 
            onClick={() => {setSearchQuery(''); setSelectedCategory('All');}}
            className="mt-6 text-kite-primary font-bold hover:underline"
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
