"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Wallet, 
  Coins, 
  UserPlus, 
  ShieldCheck, 
  CheckCircle2,
  ArrowRight,
  ArrowLeft
} from 'lucide-react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther, parseEther } from 'viem';

const steps = [
  { id: 1, title: 'Deploy Wallet', icon: Wallet },
  { id: 2, title: 'Fund Wallet', icon: Coins },
  { id: 3, title: 'Register Agent', icon: UserPlus },
  { id: 4, title: 'Set Rules', icon: ShieldCheck },
  { id: 5, title: 'All Set!', icon: CheckCircle2 },
];

export function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(1);
  const { address } = useAccount();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const [formData, setFormData] = useState({
    walletAddress: '',
    agentName: '',
    agentDomain: '',
    agentAddress: '',
    sessionKey: '',
    perTxLimit: '10',
    dailyLimit: '100',
  });

  const nextStep = () => setCurrentStep(prev => Math.min(prev + 1, steps.length));
  const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 1));

  const handleDeployWallet = async () => {
    // Mock deployment for now
    nextStep();
  };

  const handleFundWallet = async () => {
    // Mock funding
    nextStep();
  };

  const handleRegisterAgent = async () => {
    // Mock registration
    nextStep();
  };

  const handleSetRules = async () => {
    // Mock rules
    nextStep();
  };

  return (
    <div className="fixed inset-0 bg-kite-bg/80 backdrop-blur-xl z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div className="max-w-2xl w-full bg-white border border-kite-border rounded-3xl shadow-2xl overflow-hidden">
        {/* Progress Bar */}
        <div className="bg-kite-bg h-1.5 w-full flex">
          {steps.map((step) => (
            <div 
              key={step.id}
              className={`h-full transition-all duration-700 ${
                step.id <= currentStep ? 'bg-kite-primary' : 'bg-transparent'
              }`}
              style={{ width: `${100 / steps.length}%` }}
            />
          ))}
        </div>

        <div className="p-10 lg:p-14">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              {/* Step Header */}
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-kite-primary/5 rounded-2xl flex items-center justify-center text-kite-primary shadow-inner">
                  {(() => {
                    const Icon = steps[currentStep - 1].icon;
                    return <Icon size={32} />;
                  })()}
                </div>
                <div>
                  <h2 className="text-3xl font-display font-bold text-kite-primary">{steps[currentStep - 1].title}</h2>
                  <p className="text-slate-500 mt-1">Step {currentStep} of {steps.length}</p>
                </div>
              </div>

              {/* Step Content */}
              <div className="min-h-[240px]">
                {currentStep === 1 && (
                  <div className="space-y-6">
                    <p className="text-slate-600 leading-relaxed text-center text-lg">
                      Deploy your **KiteAAWallet**. This smart contract wallet holds the funds your AI agents will use to pay for services autonomously.
                    </p>
                    <div className="p-5 bg-kite-bg border border-kite-border rounded-2xl text-sm text-slate-600 flex gap-3">
                      <ShieldCheck className="text-kite-primary shrink-0" size={20} />
                      <span>You remain the sole owner of this wallet. Agents only have delegated spending power based on your rules.</span>
                    </div>
                    <button 
                      onClick={handleDeployWallet}
                      className="kite-button-primary w-full py-4 text-lg shadow-xl shadow-kite-primary/20"
                    >
                      Deploy Smart Wallet <ArrowRight size={20} />
                    </button>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-6">
                    <p className="text-slate-600 text-center text-lg">
                      Fund your wallet with KTT tokens to provide your agents with a working budget.
                    </p>
                    <div className="space-y-3">
                      <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Amount to Deposit (KTT)</label>
                      <div className="relative">
                        <input 
                          type="number" 
                          className="w-full bg-kite-bg border border-kite-border rounded-2xl px-6 py-4 text-xl font-display font-bold focus:ring-2 focus:ring-kite-primary/20 outline-none transition-all"
                          placeholder="0.00"
                        />
                        <span className="absolute right-6 top-1/2 -translate-y-1/2 font-bold text-slate-400">KTT</span>
                      </div>
                    </div>
                    <button 
                      onClick={handleFundWallet}
                      className="kite-button-primary w-full py-4 text-lg shadow-xl shadow-kite-primary/20"
                    >
                      Approve & Deposit
                    </button>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-5">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-500 uppercase tracking-wider ml-1">Agent Name</label>
                        <input 
                          className="w-full bg-kite-bg border border-kite-border rounded-2xl px-5 py-3 focus:ring-2 focus:ring-kite-primary/20 outline-none"
                          placeholder="e.g. Research Assistant"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-500 uppercase tracking-wider ml-1">Agent Domain</label>
                        <input 
                          className="w-full bg-kite-bg border border-kite-border rounded-2xl px-5 py-3 focus:ring-2 focus:ring-kite-primary/20 outline-none"
                          placeholder="e.g. research-bot.kite"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-500 uppercase tracking-wider ml-1">Agent Address</label>
                        <input 
                          className="w-full bg-kite-bg border border-kite-border rounded-2xl px-5 py-3 font-mono text-xs focus:ring-2 focus:ring-kite-primary/20 outline-none"
                          placeholder="0x..."
                        />
                      </div>
                    </div>
                    <button 
                      onClick={handleRegisterAgent}
                      className="kite-button-primary w-full py-4 text-lg shadow-xl shadow-kite-primary/20"
                    >
                      Register Agent Identity
                    </button>
                  </div>
                )}

                {currentStep === 4 && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-500 uppercase tracking-wider ml-1">Per-Tx Limit</label>
                        <input 
                          type="number"
                          className="w-full bg-kite-bg border border-kite-border rounded-2xl px-5 py-3 focus:ring-2 focus:ring-kite-primary/20 outline-none"
                          defaultValue="10"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-500 uppercase tracking-wider ml-1">Daily Limit</label>
                        <input 
                          type="number"
                          className="w-full bg-kite-bg border border-kite-border rounded-2xl px-5 py-3 focus:ring-2 focus:ring-kite-primary/20 outline-none"
                          defaultValue="100"
                        />
                      </div>
                    </div>
                    <button 
                      onClick={handleSetRules}
                      className="kite-button-primary w-full py-4 text-lg shadow-xl shadow-kite-primary/20"
                    >
                      Set Spending Rules
                    </button>
                  </div>
                )}

                {currentStep === 5 && (
                  <div className="text-center space-y-8">
                    <div className="w-24 h-24 bg-kite-primary/10 rounded-full flex items-center justify-center text-kite-primary mx-auto shadow-inner">
                      <CheckCircle2 size={56} />
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-3xl font-display font-bold text-kite-primary">Onboarding Complete</h3>
                      <p className="text-slate-500 text-lg">
                        Your agent is now empowered to transact on the Kite network.
                      </p>
                    </div>
                    <div className="p-6 bg-kite-bg border border-kite-border rounded-2xl text-left">
                      <p className="text-[10px] font-bold text-kite-accent uppercase tracking-widest mb-3">CLI Configuration</p>
                      <code className="text-kite-primary font-mono text-sm block bg-white p-3 rounded-xl border border-kite-border">npx kite vars set AGENT_1_SEED</code>
                    </div>
                    <button 
                      onClick={onComplete}
                      className="kite-button-primary w-full py-4 text-lg shadow-xl shadow-kite-primary/20"
                    >
                      Launch Dashboard
                    </button>
                  </div>
                )}
              </div>

              {/* Navigation */}
              {currentStep < 5 && (currentStep > 1) && (
                <div className="flex justify-center pt-4">
                  <button 
                    onClick={prevStep}
                    className="text-slate-400 hover:text-kite-primary font-medium flex items-center gap-2 transition-colors"
                  >
                    <ArrowLeft size={18} /> Previous Step
                  </button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
