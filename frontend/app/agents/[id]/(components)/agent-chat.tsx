import { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Bot, 
  User, 
  Zap, 
  Clock, 
  Shield, 
  CheckCircle2, 
  XCircle,
  Loader2,
  ExternalLink,
  ChevronRight,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/utils/utils';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  tools?: ToolCall[];
  payments?: PaymentEvent[];
}

interface ToolCall {
  name: string;
  params: Record<string, any>;
  status: 'pending' | 'success' | 'error';
  result?: any;
}

interface PaymentEvent {
  amount: string;
  method: 'x402' | 'channel' | 'batch';
  status: 'approved' | 'rejected' | 'pending';
  txHash?: string;
  reasoning?: string;
}

export function AgentChat({ agentName }: { agentName: string }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'agent',
      content: `Hello! I'm your **${agentName}**. How can I help you today?`,
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Simulate agent response
    setTimeout(() => {
      const agentMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: `I've researched the top AI papers for you. Lagos forecast: 32°C tomorrow, 29°C Wed, 31°C Thu. Light showers expected Wednesday.`,
        tools: [
          {
            name: 'call_paid_api',
            params: { url: 'https://api.weather-co.kite/forecast/lagos' },
            status: 'success',
            result: { temp: 32, condition: 'Sunny' }
          }
        ],
        payments: [
          {
            amount: '0.1',
            method: 'x402',
            status: 'approved',
            txHash: '0xabc123...',
            reasoning: 'Price is under auto-approve threshold (0.5 KTT)'
          }
        ]
      };
      setMessages(prev => [...prev, agentMsg]);
      setIsTyping(false);
    }, 2000);
  };

  return (
    <div className="flex flex-col h-[600px] bg-white border border-kite-border rounded-2xl overflow-hidden shadow-xl">
      {/* Chat Header */}
      <div className="p-6 border-b border-kite-border bg-kite-bg/30 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-kite-primary rounded-xl flex items-center justify-center text-white shadow-lg shadow-kite-primary/20">
            <Bot size={24} />
          </div>
          <div>
            <h3 className="font-display font-bold text-kite-primary">{agentName}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-2 h-2 bg-kite-primary rounded-full animate-pulse" />
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Active • Session Key: 0x71c...</span>
            </div>
          </div>
        </div>
        <button className="p-3 bg-white border border-kite-border rounded-xl text-slate-400 hover:text-kite-primary transition-all shadow-sm">
          <Info size={20} />
        </button>
      </div>

      {/* Messages Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar bg-white"
      >
        {messages.map((msg) => (
          <div key={msg.id} className={cn(
            "flex gap-5",
            msg.role === 'user' ? "flex-row-reverse" : ""
          )}>
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border shadow-sm",
              msg.role === 'user' ? "bg-white text-slate-400 border-kite-border" : "bg-kite-primary text-white border-kite-primary"
            )}>
              {msg.role === 'user' ? <User size={20} /> : <Bot size={20} />}
            </div>
            
            <div className={cn(
              "space-y-4 max-w-[85%]",
              msg.role === 'user' ? "items-end" : ""
            )}>
              <div className={cn(
                "p-5 rounded-2xl text-sm leading-relaxed shadow-sm border",
                msg.role === 'user' 
                  ? "bg-kite-primary text-white border-kite-primary rounded-tr-none" 
                  : "bg-kite-bg text-slate-800 border-kite-border rounded-tl-none"
              )}>
                <div className={cn(
                  "prose prose-sm max-w-none",
                  msg.role === 'user' ? "prose-invert" : "prose-slate"
                )}>
                  <ReactMarkdown>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>

              {/* Tool Calls & Payments */}
              {(msg.tools || msg.payments) && (
                <div className="space-y-3">
                  {msg.tools?.map((tool, i) => (
                    <div key={i} className="bg-kite-bg border border-kite-border rounded-xl p-4 flex items-center justify-between group shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-white border border-kite-border rounded-lg flex items-center justify-center text-kite-primary">
                          <ChevronRight size={16} />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tool Call Executed</p>
                          <p className="text-xs font-mono font-bold text-kite-primary">{tool.name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] bg-kite-primary/10 text-kite-primary px-3 py-1 rounded-full font-bold uppercase tracking-wider">SUCCESS</span>
                      </div>
                    </div>
                  ))}

                  {msg.payments?.map((pay, i) => (
                    <div key={i} className="bg-kite-accent/5 border border-kite-accent/20 rounded-xl p-5 space-y-4 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-kite-accent text-white rounded flex items-center justify-center shadow-md shadow-kite-accent/20">
                            <Zap size={14} />
                          </div>
                          <span className="text-sm font-bold text-kite-accent">Payment Executed</span>
                        </div>
                        <span className="text-lg font-display font-bold text-kite-accent">{pay.amount} KTT</span>
                      </div>
                      
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">
                        <div className="flex items-center gap-6">
                          <span className="text-slate-400">Method: <span className="text-slate-600">{pay.method}</span></span>
                          <span className="text-slate-400">Status: <span className="text-kite-primary">{pay.status}</span></span>
                        </div>
                        <a href="#" className="text-kite-accent hover:underline flex items-center gap-1">
                          {pay.txHash} <ExternalLink size={12} />
                        </a>
                      </div>

                      <div className="p-3 bg-white border border-kite-accent/10 rounded-lg text-xs text-slate-500 italic leading-relaxed">
                        &ldquo;{pay.reasoning}&rdquo;
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex gap-5">
            <div className="w-10 h-10 rounded-xl bg-kite-primary text-white flex items-center justify-center shrink-0 shadow-sm border border-kite-primary">
              <Bot size={20} />
            </div>
            <div className="bg-kite-bg border border-kite-border p-5 rounded-2xl rounded-tl-none flex gap-1.5 shadow-sm">
              <span className="w-2 h-2 bg-kite-primary rounded-full animate-bounce" />
              <span className="w-2 h-2 bg-kite-primary rounded-full animate-bounce [animation-delay:0.2s]" />
              <span className="w-2 h-2 bg-kite-primary rounded-full animate-bounce [animation-delay:0.4s]" />
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-8 bg-kite-bg/30 border-t border-kite-border">
        <div className="relative flex items-center">
          <input 
            type="text" 
            placeholder="Ask your agent to perform a task..."
            className="w-full bg-white border border-kite-border rounded-2xl pl-6 pr-16 py-4 outline-none focus:ring-2 focus:ring-kite-primary/20 shadow-sm transition-all text-slate-800"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="absolute right-3 p-3 bg-kite-primary text-white rounded-xl hover:opacity-90 disabled:opacity-50 disabled:hover:bg-kite-primary transition-all shadow-md shadow-kite-primary/20"
          >
            <Send size={20} />
          </button>
        </div>
        <p className="mt-4 text-[10px] text-slate-400 text-center font-bold uppercase tracking-widest">
          Agent will autonomously pay for services within your set rules.
        </p>
      </div>
    </div>
  );
}
